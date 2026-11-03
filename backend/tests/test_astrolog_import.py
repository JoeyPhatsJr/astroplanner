"""Task 4: header-based import preview and commit (synthetic headers, dummy coordinates 40.0/-75.0)."""

from __future__ import annotations

import base64
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from app.astrolog import importer
from app.astrolog.headers import parse_fits_header
from app.astrolog.models import CaptureFrame, CaptureSet, LibraryTarget, Stack
from app.db import ObservingSession

from .astrolog_fixtures import canon_cr2_header, seestar_sub_header, siril_stack_header

PREVIEW = "/api/astrolog/import/preview"
COMMIT = "/api/astrolog/import/commit"
SUGGEST = "/api/astrolog/import/suggest-location"
COORD_STRINGS = ("40.0", "-75.0", "SITELAT", "SITELONG")


@pytest.fixture
def api(make_client, clear_provider):
    with make_client(clear_provider) as c:
        yield c


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def fits_item(name: str, data: bytes) -> dict:
    return {"path": f"Bubble Nebula/lights/{name}", "kind": "fits", "header_b64": _b64(data), "size": 4_000_000}


def sub(obj: str, date_obs: str, exptime: float = 10.0, **kw) -> dict:
    name = f"Light_{obj}_{exptime}s_LP_{date_obs.replace(':', '').replace('-', '')}.fit"
    return fits_item(name, seestar_sub_header(object=obj, date_obs=date_obs, exptime=exptime, **kw))


def cr2_item(name: str, captured: str, **kw) -> dict:
    return {"path": f"Canon/{name}", "kind": "cr2", "header_b64": _b64(canon_cr2_header(captured=captured, **kw)),
            "size": 25_000_000}


def ngc_subs(minutes) -> list[dict]:
    return [sub("NGC 7635", f"2026-09-12T03:{m:02d}:24.634198") for m in minutes]


def make_location(c, lat=40.005, lon=-75.0, tz="America/New_York", label="Backyard") -> str:
    r = c.post("/api/locations", json={"label": label, "latitude_deg": lat, "longitude_deg": lon, "timezone": tz})
    assert r.status_code == 201
    return r.json()["id"]


def preview(c, items, **kw) -> dict:
    r = c.post(PREVIEW, json={"items": items, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def commit(c, items, location_id, **kw):
    return c.post(COMMIT, json={"items": items, "location_id": location_id, **kw})


def dbs(c):
    return c.app.state.db.session()


def key0(c, items, loc, **kw) -> str:
    """group_key of the first preview group (what the UI echoes back on commit)."""
    return preview(c, items, location_id=loc, **kw)["groups"][0]["group_key"]


def counts(c) -> dict[str, int]:
    with dbs(c) as s:
        return {m.__name__: s.scalar(select(func.count()).select_from(m))
                for m in (CaptureFrame, CaptureSet, LibraryTarget, Stack, ObservingSession)}


# ---- grouping -------------------------------------------------------------------

def test_three_subs_make_one_group_on_evening_night(api):
    make_location(api)
    p = preview(api, ngc_subs([11, 12, 13]))
    assert p["needs_location"] is False
    assert len(p["groups"]) == 1
    g = p["groups"][0]
    assert g["night_date"] == "2026-09-11"
    assert g["frames"] == 3
    assert g["captured_s"] == 30.0
    assert g["exptime_s"] == 10.0
    assert g["device"] == "Seestar S30"
    assert g["target"]["catalog_target_id"] == "ngc7635"
    assert g["target"]["kind"] == "catalog"
    assert g["filters"] == ["LP"] and g["gains"] == [200.0]
    assert g["ccd_temp_range"] == [32.0, 32.0]
    assert g["new_frames"] == 3
    assert g["first_utc"].startswith("2026-09-12T03:11:24") and g["last_utc"].startswith("2026-09-12T03:13:24")


def test_folder_spanning_midnight_two_targets_one_session(api):
    """Review Focus 1."""
    loc = make_location(api)
    items = [sub("M 27", "2026-09-12T00:28:00"), sub("M 27", "2026-09-12T02:31:00"),
             sub("NGC 7635", "2026-09-12T03:11:00"), sub("NGC 7635", "2026-09-12T09:44:00")]
    p = preview(api, items)
    assert [g["night_date"] for g in p["groups"]] == ["2026-09-11", "2026-09-11"]
    by_target = {g["target"]["catalog_target_id"]: g for g in p["groups"]}
    assert set(by_target) == {"m27", "ngc7635"}
    r = commit(api, items, loc)
    assert r.status_code == 200, r.text
    assert len(r.json()["session_ids"]) == 1
    with dbs(api) as s:
        sets = s.scalars(select(CaptureSet)).all()
        assert len(sets) == 2 and len({x.session_id for x in sets}) == 1
        sess = s.get(ObservingSession, r.json()["session_ids"][0])
        assert sess.local_night_date == "2026-09-11"
        assert sess.status == "completed" and sess.source == "imported"
        assert sess.title == "Night of 11 Sep 2026"
        assert sess.location_id == loc


def test_dst_fall_back_night():
    tz = "America/New_York"
    # 05:30Z = 01:30 EDT and 06:30Z = 01:30 EST on the fall-back morning: both belong to the 31 Oct night.
    assert importer.night_date_for(datetime(2026, 11, 1, 5, 30, tzinfo=timezone.utc), tz).isoformat() == "2026-10-31"
    assert importer.night_date_for(datetime(2026, 11, 1, 6, 30, tzinfo=timezone.utc), tz).isoformat() == "2026-10-31"
    assert importer.night_date_for(datetime(2026, 11, 1, 17, 0, tzinfo=timezone.utc), tz).isoformat() == "2026-11-01"


def test_dst_fall_back_via_preview(api):
    make_location(api)
    p = preview(api, [sub("M 27", "2026-11-01T05:30:00")])
    assert p["groups"][0]["night_date"] == "2026-10-31"


def test_reimport_inserts_only_new_frames(api):
    """Review Focus 3."""
    loc = make_location(api)
    r1 = commit(api, ngc_subs([11, 12, 13]), loc)
    assert r1.status_code == 200 and r1.json()["inserted_frames"] == 3
    five = ngc_subs([11, 12, 13, 14, 15])
    assert preview(api, five)["groups"][0]["new_frames"] == 2
    r2 = commit(api, five, loc)
    assert r2.json()["inserted_frames"] == 2
    assert r2.json()["session_ids"] == r1.json()["session_ids"]
    with dbs(api) as s:
        assert s.scalar(select(func.count()).select_from(CaptureFrame)) == 5
        assert s.scalar(select(func.count()).select_from(CaptureSet)) == 1
        assert s.scalar(select(func.count()).select_from(ObservingSession).where(
            ObservingSession.source != "planned")) == 1
    # duplicates inside one batch are not double-counted either
    assert preview(api, five + five)["groups"][0]["frames"] == 5
    r3 = commit(api, five + five, loc)
    assert r3.json()["inserted_frames"] == 0


def test_no_matching_location_needs_location_and_leaks_nothing(api):
    """Review Focus 4: the sample location (Philadelphia) is ~15 km from 40.0/-75.0."""
    items = ngc_subs([11, 12, 13])
    r = api.post(PREVIEW, json={"items": items})
    assert r.status_code == 200
    p = r.json()
    assert p["needs_location"] is True
    assert p["location_candidates"] == []
    assert len(p["groups"]) == 1 and p["groups"][0]["night_date"] == "2026-09-11"  # header timezone
    for s in COORD_STRINGS:
        assert s not in r.text
    rc = api.post(COMMIT, json={"items": items})
    assert rc.status_code == 422
    for s in COORD_STRINGS:
        assert s not in rc.text
    assert items[0]["header_b64"][:200] not in rc.text  # the request body is not echoed back


def test_responses_never_contain_header_coordinates(api):
    loc = make_location(api)
    items = [sub("NGC 7635", "2026-09-12T03:11:00", SITELAT=40.0936, SITELONG=-75.304),
             fits_item("stack.fit", siril_stack_header(SITELAT=40.0936, SITELONG=-75.304))]
    rp = api.post(PREVIEW, json={"items": items})
    rc = commit(api, items, loc)
    for r in (rp, rc):
        assert r.status_code == 200
        assert "40.09" not in r.text and "-75.3" not in r.text and "SITELAT" not in r.text


def test_match_location_pure():
    near = SimpleNamespace(id="near", label="Near", latitude_deg=40.005, longitude_deg=-75.0)
    far = SimpleNamespace(id="far", label="Far", latitude_deg=40.06, longitude_deg=-75.0)  # ~6.7 km
    closer = SimpleNamespace(id="closer", label="Closer", latitude_deg=40.001, longitude_deg=-75.0)
    match, cands = importer.match_location(40.0, -75.0, [far, near, closer])
    assert match is closer
    assert [c["id"] for c in cands] == ["closer", "near"]
    assert all(set(c) == {"id", "label", "distance_km"} for c in cands)
    match, cands = importer.match_location(40.0, -75.0, [far])
    assert match is None and cands == []


def test_bad_items_are_skipped_rest_imports(api):
    """Review Focus 2."""
    loc = make_location(api)
    good = ngc_subs([11, 12])
    truncated = fits_item("Light_bad_cut.fit", seestar_sub_header()[:800])
    garbage = fits_item("Light_garbage.fit", b"this is not a fits file" * 200)
    not_b64 = {"path": "x/Light_nob64.fit", "kind": "fits", "header_b64": "@@@not base64@@@", "size": 10}
    items = good + [truncated, garbage, not_b64]
    p = preview(api, items, location_id=loc)
    skipped = {x["path"]: x["reason"] for x in p["skipped"]}
    assert set(skipped) == {truncated["path"], garbage["path"], not_b64["path"]}
    assert all(skipped.values())
    assert p["groups"][0]["frames"] == 2
    r = commit(api, items, loc)
    assert r.json()["inserted_frames"] == 2
    assert len(r.json()["skipped"]) == 3


def test_ignored_paths_are_skipped(api):
    loc = make_location(api)
    item = sub("NGC 7635", "2026-09-12T03:11:00")
    item["path"] = "Bubble Nebula/process/pp_light_00001.fit"
    p = preview(api, [item], location_id=loc)
    assert p["groups"] == [] and p["skipped"][0]["path"] == item["path"]


# ---- plans -----------------------------------------------------------------------

def make_plan(c, loc, night="2026-09-11", title="Plan") -> str:
    r = c.post("/api/sessions", json={"title": title, "local_night_date": night, "location_id": loc})
    assert r.status_code == 201
    return r.json()["id"]


def test_attaches_to_single_matching_plan(api):
    loc = make_location(api)
    plan = make_plan(api, loc)
    make_plan(api, loc, night="2026-09-12", title="Other night")
    items = ngc_subs([11, 12, 13])
    assert preview(api, items)["groups"][0]["plan_session_ids"] == [plan]
    r = commit(api, items, loc)
    assert r.json()["session_ids"] == [plan]
    with dbs(api) as s:
        sess = s.get(ObservingSession, plan)
        assert sess.source == "both" and sess.status == "completed"
        assert s.scalar(select(func.count()).select_from(ObservingSession)) == 2


def test_plan_without_location_is_a_candidate(api):
    loc = make_location(api)
    plan = make_plan(api, None)
    r = commit(api, ngc_subs([11]), loc)
    assert r.json()["session_ids"] == [plan]
    with dbs(api) as s:
        assert s.get(ObservingSession, plan).location_id == loc


def test_several_plans_require_a_choice(api):
    loc = make_location(api)
    a, b = make_plan(api, loc, title="A"), make_plan(api, None, title="B")
    items = ngc_subs([11, 12])
    assert sorted(preview(api, items)["groups"][0]["plan_session_ids"]) == sorted([a, b])
    assert commit(api, items, loc).status_code == 422
    assert commit(api, items, loc, plan_session_id="nope").status_code == 422
    r = commit(api, items, loc, plan_session_id=b)
    assert r.status_code == 200 and r.json()["session_ids"] == [b]
    with dbs(api) as s:
        assert s.get(ObservingSession, a).source == "planned"
        assert s.get(ObservingSession, b).source == "both"


# ---- equipment, Canon, unsorted, stacks ------------------------------------------

def test_capture_set_snapshot_of_matched_equipment(api):
    loc = make_location(api)
    commit(api, ngc_subs([11]), loc)
    with dbs(api) as s:
        cs = s.scalars(select(CaptureSet)).one()
        assert cs.device == "Seestar S30"
        assert cs.equipment_id == "seestar-s30"
        assert cs.equipment_snapshot["id"] == "seestar-s30" and cs.equipment_snapshot["focal_length_mm"] == 150.0


def test_unknown_camera_has_no_snapshot(api):
    loc = make_location(api)
    commit(api, [sub("NGC 7635", "2026-09-12T03:11:00", INSTRUME="ZWO ASI2600MC")], loc)
    with dbs(api) as s:
        cs = s.scalars(select(CaptureSet)).one()
        assert cs.device == "ZWO ASI2600MC" and cs.equipment_id is None and cs.equipment_snapshot is None


def canon_items(day="2026:08:12", times=("22:19:50", "22:20:20", "22:20:50")) -> list[dict]:
    return [cr2_item(f"IMG_{i:04d}_{day[-2:]}.CR2", f"{day} {t}") for i, t in enumerate(times)]


def test_canon_needs_location_but_still_groups(api):
    p = preview(api, canon_items())
    assert p["needs_location"] is True
    assert p["groups"][0]["night_date"] == "2026-08-12"


def test_canon_local_time_night_and_named_set_accumulates(api):
    loc = make_location(api)
    items = canon_items()
    p = preview(api, items, location_id=loc, clock_offset_minutes=0)
    assert p["needs_location"] is False
    g = p["groups"][0]
    assert g["night_date"] == "2026-08-12"
    assert g["device"] == "Canon EOS REBEL T3"
    assert g["frames"] == 3 and g["captured_s"] == 60.0
    assert g["first_utc"].startswith("2026-08-13T02:19:50")  # 22:19:50 EDT
    assert g["group_key"]
    r = commit(api, items, loc, clock_offset_minutes=0, canon_set_names={g["group_key"]: "Milky Way (wide field)"})
    assert r.status_code == 200, r.text
    with dbs(api) as s:
        lt = s.scalars(select(LibraryTarget)).one()
        assert lt.kind == "custom" and lt.custom_name == "Milky Way (wide field)" and lt.catalog_target_id is None
        cs = s.scalars(select(CaptureSet)).one()
        assert cs.equipment_id == "canon-t3-18-55" and cs.equipment_snapshot["id"] == "canon-t3-18-55"
    more = canon_items(day="2026:08:14", times=("21:00:00", "21:00:30"))
    r2 = commit(api, more, loc, canon_set_names={key0(api, more, loc): "Milky Way (wide field)"})
    assert r2.json()["inserted_frames"] == 2
    with dbs(api) as s:
        assert s.scalar(select(func.count()).select_from(LibraryTarget)) == 1
        assert s.scalar(select(func.count()).select_from(CaptureSet)) == 2
        assert s.scalar(select(func.count()).select_from(ObservingSession)) == 2


def test_canon_clock_offset_moves_night(api):
    loc = make_location(api)
    items = [cr2_item("IMG_1.CR2", "2026:08:13 12:30:00")]
    assert preview(api, items, location_id=loc)["groups"][0]["night_date"] == "2026-08-13"
    p = preview(api, items, location_id=loc, clock_offset_minutes=-60)  # camera was an hour fast
    assert p["groups"][0]["night_date"] == "2026-08-12"
    assert p["groups"][0]["first_utc"].startswith("2026-08-13T15:30:00")


def test_canon_set_named_like_catalog_target_uses_catalog(api):
    loc = make_location(api)
    commit(api, canon_items(), loc, canon_set_names={key0(api, canon_items(), loc): "M42"})
    with dbs(api) as s:
        lt = s.scalars(select(LibraryTarget)).one()
        assert lt.kind == "catalog" and lt.catalog_target_id == "m42"


def test_unsorted_groups(api):
    loc = make_location(api)
    items = [sub("M 27", "2026-09-12T00:28:00"), sub("NGC 7635", "2026-09-12T03:11:00")]
    p = preview(api, items)
    gk = next(g["group_key"] for g in p["groups"] if g["target"]["catalog_target_id"] == "m27")
    assert commit(api, items, loc, unsorted_groups=[gk]).status_code == 200
    with dbs(api) as s:
        kinds = {lt.kind: lt for lt in s.scalars(select(LibraryTarget))}
        assert set(kinds) == {"unsorted", "catalog"}
        assert kinds["unsorted"].normalized_key == "unsorted"
    bad = commit(api, items, loc, unsorted_groups=["g-not-a-group"])
    assert bad.status_code == 422 and bad.json()["detail"] == "Unknown group; re-run the preview."
    assert commit(api, items, loc, canon_set_names={"0": "X"}).status_code == 422  # old index form is gone


def test_unknown_object_becomes_custom_target(api):
    loc = make_location(api)
    p = preview(api, [sub("Comet C/2026 X1", "2026-09-12T03:11:00")])
    assert p["groups"][0]["target"]["kind"] == "custom"
    commit(api, [sub("Comet C/2026 X1", "2026-09-12T03:11:00")], loc)
    with dbs(api) as s:
        assert s.scalars(select(LibraryTarget)).one().custom_name == "Comet C/2026 X1"


def test_stack_header_is_previewed_and_committed(api):
    loc = make_location(api)
    stack = fits_item("NGC 7635_654x10sec_T32degC_2026-09-11.fit", siril_stack_header())
    p = preview(api, [stack] + ngc_subs([11]))
    assert len(p["stacks"]) == 1 and len(p["groups"]) == 1
    st = p["stacks"][0]
    assert st["stack_count"] == 654 and st["livetime_s"] == 6540.0 and st["provenance"] == "header"
    assert st["target"]["catalog_target_id"] == "ngc7635"
    r = commit(api, [stack] + ngc_subs([11]), loc)
    assert r.json()["inserted_stacks"] == 1
    with dbs(api) as s:
        row = s.scalars(select(Stack)).one()
        assert row.provenance == "header" and row.program == "Siril 1.4.4"
        assert row.session_id == r.json()["session_ids"][0]
    assert commit(api, [stack], loc).json()["inserted_stacks"] == 0


def test_frame_dedup_key_stable_and_filename_sensitive():
    info = parse_fits_header(seestar_sub_header())
    k = importer.frame_dedup_key(info, "a.fit")
    assert k == importer.frame_dedup_key(info, "a.fit")
    assert k != importer.frame_dedup_key(info, "b.fit")
    assert len(k) <= 200


def test_too_many_items_rejected(api):
    one = ngc_subs([11])[0]
    assert api.post(PREVIEW, json={"items": [one] * 301}).status_code == 422


def test_unknown_location_id_rejected(api):
    assert api.post(PREVIEW, json={"items": ngc_subs([11]), "location_id": "nope"}).status_code == 422


# ---- suggest-location --------------------------------------------------------------

def test_suggest_location_is_rounded(api):
    items = [sub("NGC 7635", "2026-09-12T03:11:00", SITELAT=40.0936, SITELONG=-75.304)]
    r = api.post(SUGGEST, json={"items": items})
    assert r.status_code == 200
    body = r.json()
    assert body == {"latitude_deg": 40.09, "longitude_deg": -75.3, "timezone": "America/New_York"}
    assert "40.0936" not in r.text and "-75.304" not in r.text


def test_suggest_location_without_coordinates(api):
    r = api.post(SUGGEST, json={"items": canon_items()})
    assert r.status_code == 422


# ---- fix round 1 ----------------------------------------------------------------------

def test_group_keys_are_stable_and_distinct(api):
    loc = make_location(api)
    items = [sub("M 27", "2026-09-12T00:28:00"), sub("NGC 7635", "2026-09-12T03:11:00")]
    a = [g["group_key"] for g in preview(api, items, location_id=loc)["groups"]]
    b = [g["group_key"] for g in preview(api, list(reversed(items)), location_id=loc)["groups"]]
    assert a == b and len(set(a)) == 2


def test_reimport_with_new_name_is_a_no_op(api):
    """A re-import never moves frames already imported: no new target, capture set, session or plan change."""
    loc_a = make_location(api)
    items = canon_items()
    assert commit(api, items, loc_a).json()["inserted_frames"] == 3  # unnamed -> Unsorted
    loc_b = make_location(api, lat=41.0, lon=-74.0, label="Elsewhere")
    plan = make_plan(api, loc_b, night="2026-08-12")
    before = counts(api)
    r = commit(api, items, loc_b, canon_set_names={key0(api, items, loc_b): "Milky Way (wide field)"})
    assert r.status_code == 200, r.text
    assert r.json() == {"session_ids": [], "inserted_frames": 0, "inserted_stacks": 0, "skipped": []}
    assert counts(api) == before
    with dbs(api) as s:
        p = s.get(ObservingSession, plan)
        assert p.status == "planned" and p.source == "planned"
        assert s.scalars(select(LibraryTarget)).one().kind == "unsorted"


def test_duplicate_stack_creates_nothing(api):
    loc = make_location(api)
    stack = fits_item("Comet_12x10sec.fit", siril_stack_header(OBJECT="Comet C/2026 X1"))
    commit(api, [stack], loc)
    before = counts(api)
    assert commit(api, [stack], loc).json()["inserted_stacks"] == 0
    assert counts(api) == before


def test_cancelled_or_completed_plans_are_not_candidates(api):
    loc = make_location(api)
    cancelled = make_plan(api, loc, title="Cancelled")
    api.patch(f"/api/sessions/{cancelled}", json={"status": "cancelled"})
    done = make_plan(api, loc, title="Done")
    api.patch(f"/api/sessions/{done}", json={"status": "completed"})
    items = ngc_subs([11])
    assert preview(api, items)["groups"][0]["plan_session_ids"] == []
    sid = commit(api, items, loc).json()["session_ids"][0]
    assert sid not in (cancelled, done)
    with dbs(api) as s:
        assert s.get(ObservingSession, cancelled).status == "cancelled"
        assert s.get(ObservingSession, cancelled).source == "planned"


def test_night_title_is_locale_independent():
    import locale
    from datetime import date

    old = locale.setlocale(locale.LC_TIME)
    try:
        for name in ("de_DE.UTF-8", "fr_FR.UTF-8"):
            try:
                locale.setlocale(locale.LC_TIME, name)
                break
            except locale.Error:
                continue
        assert importer._night_title(date(2026, 5, 3)) == "Night of 3 May 2026"
        assert importer._night_title(date(2026, 12, 31)) == "Night of 31 Dec 2026"
    finally:
        locale.setlocale(locale.LC_TIME, old)


def test_custom_target_stores_object_ra_dec_not_site(api):
    loc = make_location(api)
    commit(api, [sub("Comet C/2026 X1", "2026-09-12T03:11:00", RA=12.5, DEC=-3.25)], loc)
    with dbs(api) as s:
        lt = s.scalars(select(LibraryTarget)).one()
        assert (lt.ra_deg, lt.dec_deg) == (12.5, -3.25)
    commit(api, ngc_subs([11]), loc)  # catalog targets keep the catalog's coordinates, not the header's
    with dbs(api) as s:
        cat = s.scalars(select(LibraryTarget).where(LibraryTarget.kind == "catalog")).one()
        assert cat.ra_deg is None and cat.dec_deg is None


def test_failed_commit_writes_nothing(api):
    """Atomicity: errors raised after rows were flushed still leave the DB untouched."""
    loc = make_location(api)
    make_plan(api, loc, title="A")
    make_plan(api, None, title="B")
    before = counts(api)
    assert commit(api, ngc_subs([11, 12]), loc).status_code == 422  # several plans, no choice
    assert counts(api) == before
    # single-night import whose plan_session_id matches nothing: rows are flushed before the check fails
    other = make_plan(api, loc, night="2026-01-01", title="Unrelated")
    before = counts(api)
    r = commit(api, [sub("M 27", "2026-11-01T05:30:00")], loc, plan_session_id=other)
    assert r.status_code == 422
    assert counts(api) == before
    with dbs(api) as s:
        assert s.get(ObservingSession, other).source == "planned"


def test_request_location_overrides_header_match(api):
    near = make_location(api)  # header coordinates match this one
    far = make_location(api, lat=34.05, lon=-118.24, tz="America/Los_Angeles", label="Far away")
    items = [sub("M 27", "2026-09-12T05:30:00")]  # 01:30 EDT (night 11 Sep) but 22:30 PDT (night 11 Sep)
    p = preview(api, items)
    assert p["location_id"] == near
    p2 = preview(api, items, location_id=far)
    assert p2["location_id"] == far and p2["needs_location"] is False
    late = [sub("M 27", "2026-09-12T18:30:00")]  # 14:30 EDT -> night 12 Sep; 11:30 PDT -> night 11 Sep
    assert preview(api, late)["groups"][0]["night_date"] == "2026-09-12"
    assert preview(api, late, location_id=far)["groups"][0]["night_date"] == "2026-09-11"
    sid = commit(api, late, far).json()["session_ids"][0]
    with dbs(api) as s:
        assert s.get(ObservingSession, sid).location_id == far


def _coordinate_renderings(*values: float) -> set[str]:
    out = set()
    for v in values:
        out.add(repr(v))
        out.add(str(v))
        for d in range(3, 8):
            out.add(f"{v:.{d}f}")
    return out


def test_db_never_contains_header_coordinates(api):
    lat, lon = 40.0936123, -75.3041234
    loc = make_location(api, lat=40.08, lon=-75.30)
    items = [sub("NGC 7635", "2026-09-12T03:11:00", SITELAT=lat, SITELONG=lon),
             sub("Comet C/2026 X1", "2026-09-12T04:11:00", SITELAT=lat, SITELONG=lon, RA=12.5, DEC=-3.25),
             fits_item("stack.fit", siril_stack_header(SITELAT=lat, SITELONG=lon))]
    assert preview(api, items)["location_id"] == loc  # matched via the header coordinates
    assert commit(api, items, loc).status_code == 200
    needles = _coordinate_renderings(lat, lon)
    from sqlalchemy import text

    with dbs(api) as s:
        for table in ("sessions", "capture_sets", "capture_frames", "stacks", "library_targets"):
            rows = s.execute(text(f"SELECT * FROM {table}")).all()
            assert rows, table
            for row in rows:
                for value in row:
                    cell = "" if value is None else str(value)
                    hits = [n for n in needles if n in cell]
                    assert not hits, f"{table} contains a header coordinate rendering"
