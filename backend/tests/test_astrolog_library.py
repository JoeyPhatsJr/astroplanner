"""Task 6: library, target page, plan vs actual, history (synthetic data, dummy coordinates 40.0/-75.0)."""

from __future__ import annotations

import io
import json
import re
from datetime import datetime, timedelta, timezone

import pytest
from PIL import Image
from sqlalchemy import select

from app.astrolog.models import CaptureSet, Stack
from app.db import EquipmentProfile

from .astrolog_fixtures import seestar_sub_header, siril_stack_header
from .test_astrolog_import import COMMIT, commit, fits_item, make_location, sub

LIB = "/api/astrolog/library"
START = datetime(2026, 9, 12, 3, 11, 24, tzinfo=timezone.utc)
COORD_RE = re.compile(r"(?<![\d.])-?(40|75)\.0(?!\d)|SITELAT|SITELONG")


@pytest.fixture
def api(make_client, clear_provider):
    with make_client(clear_provider) as c:
        yield c


def ngc_frames(n=1015, step=23) -> list[dict]:
    out = []
    for i in range(n):
        t = (START + timedelta(seconds=step * i)).strftime("%Y-%m-%dT%H:%M:%S.000000")
        out.append(fits_item(f"Light_NGC7635_{i:04d}.fit", seestar_sub_header(object="NGC 7635", date_obs=t)))
    return out


def stack_item(name="Stacked_654_NGC 7635_6540.0s.fit", **kw) -> dict:
    return fits_item(name, siril_stack_header(**kw))


def lib_id(c, catalog_id="ngc7635") -> str:
    rows = c.get(LIB).json()
    return next(r["id"] for r in rows if r["catalog_target_id"] == catalog_id)


def upload(c, tid, stack_id=None):
    b = io.BytesIO()
    Image.new("RGB", (60, 40), (5, 5, 90)).save(b, "JPEG")
    data = {"stack_id": stack_id} if stack_id else {}
    r = c.post(f"/api/astrolog/targets/{tid}/final-image", files={"file": ("final.jpg", b.getvalue())}, data=data)
    assert r.status_code == 200, r.text
    return r.json()


def seeded(c, with_stack=True, link=True):
    loc = make_location(c)
    items = ngc_frames() + ([stack_item(EXPEND=2461296.0)] if with_stack else [])
    for i in range(0, len(items), 250):  # the API takes at most 300 items per request
        assert commit(c, items[i:i + 250], loc).status_code == 200
    tid = lib_id(c)
    if with_stack and link:
        with c.app.state.db.session() as s:
            sid = s.scalars(select(Stack)).one().id
        upload(c, tid, sid)
    return tid


def test_headline_stack_and_percent_used(api):
    tid = seeded(api)
    t = api.get(f"/api/astrolog/targets/{tid}").json()
    assert t["headline"]["seconds"] == 6540.0 and t["headline"]["label"] == "stack"
    assert t["headline"]["provenance"] == "header"
    assert t["captured_s"] == 10150.0 and t["frames_total"] == 1015
    assert t["percent_used"] == pytest.approx(64.4, abs=0.1)
    assert t["stack"]["stack_count"] == 654 and t["final_image"]["format"] == "JPEG"
    assert t["target"]["display_name"] == "Bubble Nebula"
    assert len(t["nights"]) == 1 and t["nights"][0]["frames"] == 1015 and t["nights"][0]["captured_s"] == 10150.0
    assert t["nights"][0]["night_date"] == "2026-09-11" and t["nights"][0]["planned"] is False
    assert t["nights"][0]["first_utc"] < t["nights"][0]["last_utc"]
    facts = {f["source_key"]: f["value"] for f in t["facts"]}
    assert {"FILTER", "GAIN", "CCD-TEMP", "INSTRUME"} <= set(facts)
    assert facts["FILTER"] == "LP" and facts["INSTRUME"] == "Seestar S30"


def test_percent_used_null_without_range(api):
    loc = make_location(api)
    commit(api, ngc_frames(50), loc)
    tid = lib_id(api)
    assert api.get(f"/api/astrolog/targets/{tid}").json()["percent_used"] is None


def test_captured_headline_without_stack_or_link(api):
    tid = seeded(api, with_stack=False)
    t = api.get(f"/api/astrolog/targets/{tid}").json()
    assert t["headline"] == {"seconds": 10150.0, "label": "captured", "provenance": "frames", "basis": None}
    assert t["percent_used"] is None and t["stack_suggestion_id"] is None and t["final_image"] is None
    row = next(r for r in api.get(LIB).json() if r["id"] == tid)
    assert row["headline"]["label"] == "captured" and row["nights"] == 1


def test_unlinked_stack_does_not_become_headline(api):
    tid = seeded(api, link=False)
    t = api.get(f"/api/astrolog/targets/{tid}").json()
    assert t["headline"]["label"] == "captured" and t["headline"]["seconds"] == 10150.0
    assert t["stack"] is None


def test_two_stacks_never_add(api):
    tid = seeded(api)
    loc = api.get("/api/locations").json()[0]["id"]
    other = stack_item("Stacked_300_NGC 7635_3000.0s.fit", stack_count=300, livetime=3000.0)
    assert commit(api, [other], loc).status_code == 200
    with api.app.state.db.session() as s:
        assert len(list(s.scalars(select(Stack)))) == 2
    t = api.get(f"/api/astrolog/targets/{tid}").json()
    assert t["headline"]["seconds"] == 6540.0
    assert api.get("/api/astrolog/history").json()["ngc7635"]["seconds"] == 6540.0


def test_stack_suggestion_from_previews_rule(api):
    tid = seeded(api, link=False)
    upload(api, tid)  # final image with no stack: filename "final.jpg"
    t = api.get(f"/api/astrolog/targets/{tid}").json()
    with api.app.state.db.session() as s:
        sid = s.scalars(select(Stack)).one().id
    assert t["stack_suggestion_id"] == sid and t["stack"] is None


def test_headline_fallbacks_without_livetime(api):
    loc = make_location(api)
    commit(api, ngc_frames(3), loc)
    tid = lib_id(api)
    with api.app.state.db.session() as s:
        for kw, want in (({"livetime_s": None, "stack_count": 20, "exptime_s": 10.0}, 200.0),
                         ({"livetime_s": None, "stack_count": None, "exptime_s": None,
                           "source_filename": "NGC_7635_77x10sec.fit"}, 770.0)):
            s.add(Stack(owner_id=api.user_id, library_target_id=tid, provenance="header",
                        source_filename=kw.pop("source_filename", "x.fit"),
                        dedup_key=f"k{want}", **kw))
        s.commit()
        ids = {st.dedup_key: st.id for st in s.scalars(select(Stack))}
    for key, want in (("k200.0", 200.0), ("k770.0", 770.0)):
        upload(api, tid, ids[key])
        assert api.get(f"/api/astrolog/targets/{tid}").json()["headline"]["seconds"] == want


def test_history_and_library(api):
    tid = seeded(api)
    assert api.get("/api/astrolog/history").json()["ngc7635"] == {"seconds": 6540.0, "label": "stack", "library_target_id": tid}
    row = api.get(LIB).json()[0]
    assert row["id"] == tid and row["display_name"] == "Bubble Nebula" and row["kind"] == "catalog"
    assert row["category"] == "nebula" and row["thumb_url"].endswith("/thumb")
    assert row["headline"]["seconds"] == 6540.0 and row["captured_s"] == 10150.0 and row["nights"] == 1


def test_library_sorted_by_recent_capture(api):
    loc = make_location(api)
    commit(api, [sub("NGC 7635", "2026-09-12T03:11:24"), sub("M 27", "2026-10-12T03:11:24")], loc)
    names = [r["display_name"] for r in api.get(LIB).json()]
    assert names[0] != "Bubble Nebula" and "Bubble Nebula" in names


def test_patch_target(api):
    loc = make_location(api)
    commit(api, [sub("NGC 7635", "2026-09-12T03:11:24"), sub("Mystery Blob", "2026-09-12T03:12:24")], loc)
    rows = api.get(LIB).json()
    cat = next(r for r in rows if r["kind"] == "catalog")
    cus = next(r for r in rows if r["kind"] == "custom")
    assert api.patch(f"/api/astrolog/targets/{cat['id']}", json={"custom_name": "x"}).status_code == 403
    r = api.patch(f"/api/astrolog/targets/{cus['id']}", json={"custom_name": "My Blob"})
    assert r.status_code == 200 and r.json()["target"]["display_name"] == "My Blob"
    r = api.patch(f"/api/astrolog/targets/{cus['id']}", json={"kind": "unsorted"})
    assert r.json()["target"]["kind"] == "unsorted" and r.json()["target"]["display_name"] == "Unsorted"
    assert api.patch(f"/api/astrolog/targets/{cus['id']}", json={"kind": "catalog"}).status_code == 422
    assert api.patch(f"/api/astrolog/targets/{cus['id']}", json={"custom_name": ""}).status_code == 422
    assert api.patch("/api/astrolog/targets/nope", json={"custom_name": "a"}).status_code == 404
    assert api.get("/api/astrolog/targets/nope").status_code == 404


def test_plan_vs_actual_not_shot(api):
    loc = make_location(api)
    s = api.post("/api/sessions", json={"title": "Plan", "local_night_date": "2026-09-11", "location_id": loc})
    sid = s.json()["id"]
    for t in ("m27", "m31"):
        assert api.post(f"/api/sessions/{sid}/targets", json={"target_id": t}).status_code == 201
    assert api.get(f"/api/sessions/{sid}").json()["not_shot"] == []  # nothing imported yet
    r = commit(api, [sub("M 27", "2026-09-12T03:11:24")], loc, plan_session_id=sid)
    assert r.status_code == 200, r.text
    d = api.get(f"/api/sessions/{sid}").json()
    assert d["not_shot"] == ["m31"] and d["source"] == "both" and d["status"] == "completed"
    cs = d["capture_sets"]
    assert len(cs) == 1 and cs[0]["display_name"] == "Dumbbell Nebula" and cs[0]["frames"] == 1
    assert cs[0]["captured_s"] == 10.0 and cs[0]["device"] == "Seestar S30"
    assert [x["id"] for x in api.get("/api/sessions").json() if x["id"] == sid]


def test_equipment_edit_leaves_snapshot(api):
    loc = make_location(api)
    commit(api, [sub("NGC 7635", "2026-09-12T03:11:24")], loc)
    with api.app.state.db.session() as s:
        sid = s.scalars(select(CaptureSet)).one().session_id
        eq = s.get(EquipmentProfile, "seestar-s30")
        eq.focal_length_mm = 999.0
        s.commit()
    cs = api.get(f"/api/sessions/{sid}").json()["capture_sets"][0]
    assert cs["equipment_snapshot"]["focal_length_mm"] == 150.0


def test_no_header_coordinates_anywhere(api):
    tid = seeded(api)
    bodies = [api.get(LIB).text, api.get(f"/api/astrolog/targets/{tid}").text, api.get("/api/astrolog/history").text,
              api.get("/api/sessions").text]
    with api.app.state.db.session() as db:
        sess = db.scalars(select(CaptureSet)).one().session_id
    bodies.append(api.get(f"/api/sessions/{sess}").text)
    for b in bodies:
        assert not COORD_RE.search(b)
    t = api.get(f"/api/astrolog/targets/{tid}").json()
    assert "ra_deg" not in t["target"] and "dec_deg" not in t["target"]


def _stack_only(api, **kw):
    loc = make_location(api)
    assert commit(api, [stack_item(**kw)], loc).status_code == 200
    return lib_id(api)


def test_stack_only_target_listed_with_unknown_captured(api):
    tid = _stack_only(api)
    row = next(r for r in api.get(LIB).json() if r["id"] == tid)
    assert row["headline"]["seconds"] == 6540.0 and row["headline"]["label"] == "stack"
    assert row["captured_s"] is None
    t = api.get(f"/api/astrolog/targets/{tid}").json()
    assert t["captured_s"] is None and t["frames_total"] == 0 and t["percent_used"] is None
    assert t["headline"]["label"] == "stack" and t["headline"]["seconds"] == 6540.0
    assert api.get("/api/astrolog/history").json()["ngc7635"] == {"seconds": 6540.0, "label": "stack", "library_target_id": tid}


def test_frames_plus_unlinked_stack_keeps_captured_headline(api):
    tid = seeded(api, link=False)
    row = next(r for r in api.get(LIB).json() if r["id"] == tid)
    assert row["headline"]["label"] == "captured" and row["headline"]["seconds"] == 10150.0
    assert api.get("/api/astrolog/history").json()["ngc7635"] == {"seconds": 10150.0, "label": "captured", "library_target_id": tid}


def test_linked_stack_without_integration_falls_back_to_captured(api):
    loc = make_location(api)
    commit(api, ngc_frames(3), loc)
    tid = lib_id(api)
    with api.app.state.db.session() as s:
        st = Stack(owner_id=api.user_id, library_target_id=tid, source_filename="mystery.fit", provenance="header",
                   dedup_key="none")
        s.add(st); s.commit(); sid = st.id
    upload(api, tid, sid)
    h = api.get(f"/api/astrolog/targets/{tid}").json()["headline"]
    assert h == {"seconds": 30.0, "label": "captured", "provenance": "frames", "basis": None}


# ---- final review fixes (I1-I4, M1-M3) ------------------------------------------------------

def frames_at(start: datetime, n: int, step=23, obj="NGC 7635", exptime=10.0) -> list[dict]:
    out = []
    for i in range(n):
        t = (start + timedelta(seconds=step * i)).strftime("%Y-%m-%dT%H:%M:%S.000000")
        out.append(fits_item(f"Light_{obj.replace(' ', '')}_{start:%m%d}_{i:04d}.fit",
                             seestar_sub_header(object=obj, date_obs=t, exptime=exptime)))
    return out


def commit_chunks(c, items, loc, **kw):
    for i in range(0, len(items), 250):
        r = commit(c, items[i:i + 250], loc, **kw)
        assert r.status_code == 200, r.text


def test_i1_frames_in_stack_range_excludes_other_nights(api):
    tid = seeded(api)
    loc = api.get("/api/locations").json()[0]["id"]
    commit_chunks(api, frames_at(datetime(2026, 9, 21, 3, 0, 0, tzinfo=timezone.utc), 500), loc)
    t = api.get(f"/api/astrolog/targets/{tid}").json()
    assert t["frames_total"] == 1515
    assert t["frames_in_stack_range"] == 1015
    assert t["percent_used"] == pytest.approx(64.4, abs=0.1)


def test_i1_stack_count_above_range_hides_percent(api):
    loc = make_location(api)
    commit_chunks(api, ngc_frames(100) + [stack_item(EXPEND=2461296.0)], loc)
    tid = lib_id(api)
    with api.app.state.db.session() as s:
        sid = s.scalars(select(Stack)).one().id
    upload(api, tid, sid)
    t = api.get(f"/api/astrolog/targets/{tid}").json()
    assert t["stack"]["stack_count"] == 654
    assert t["percent_used"] is None and t["frames_in_stack_range"] is None


def test_i1_seeded_reports_range_count(api):
    tid = seeded(api)
    assert api.get(f"/api/astrolog/targets/{tid}").json()["frames_in_stack_range"] == 1015


def canon_named(api, loc, name="Milky Way (wide field)"):
    from .test_astrolog_import import canon_items, key0
    items = canon_items()
    r = commit(api, items, loc, canon_set_names={key0(api, items, loc): name})
    assert r.status_code == 200, r.text
    return next(x["id"] for x in api.get(LIB).json() if x["display_name"] == name)


def test_i2_canon_exif_stored_and_shown(api):
    from app.astrolog.models import CaptureFrame
    loc = make_location(api)
    tid = canon_named(api, loc)
    with api.app.state.db.session() as s:
        frames = list(s.scalars(select(CaptureFrame)))
        cs = s.scalars(select(CaptureSet)).one()
        assert len(frames) == 3
        assert {f.iso for f in frames} == {640}
        assert {f.f_number for f in frames} == {3.5}
        assert {f.focal_mm for f in frames} == {18.0}
        assert cs.lens == "EF-S18-55mm f/3.5-5.6 IS II"
    facts = {f["source_key"]: f for f in api.get(f"/api/astrolog/targets/{tid}").json()["facts"]}
    assert facts["EXIF Model"]["label"] == "Camera" and facts["EXIF Model"]["value"] == "Canon EOS REBEL T3"
    assert facts["EXIF LensModel"]["label"] == "Lens" and facts["EXIF LensModel"]["value"] == "EF-S18-55mm f/3.5-5.6 IS II"
    assert facts["EXIF ISOSpeedRatings"]["label"] == "ISO" and facts["EXIF ISOSpeedRatings"]["value"] == "640"
    assert facts["EXIF FNumber"]["value"] == "f/3.5"
    assert facts["EXIF FocalLength"]["value"] == "18 mm"
    assert facts["EXIF ExposureTime"]["label"] == "Exposure" and facts["EXIF ExposureTime"]["value"] == "20 s"
    assert "INSTRUME" not in facts and "FILTER" not in facts


def test_i2_mixed_iso_shows_range(api):
    from .test_astrolog_import import cr2_item, key0
    loc = make_location(api)
    items = [cr2_item(f"IMG_{i}.CR2", f"2026:08:12 22:{19 + i}:50", iso=iso) for i, iso in enumerate((400, 1600, 800))]
    commit(api, items, loc, canon_set_names={key0(api, items, loc): "Wide"})
    tid = next(x["id"] for x in api.get(LIB).json() if x["display_name"] == "Wide")
    facts = {f["source_key"]: f["value"] for f in api.get(f"/api/astrolog/targets/{tid}").json()["facts"]}
    assert facts["EXIF ISOSpeedRatings"] == "400 to 1600"


def test_i2_fits_frames_leave_exif_null_and_keep_fits_keys(api):
    from app.astrolog.models import CaptureFrame
    tid = seeded(api, with_stack=False)
    with api.app.state.db.session() as s:
        f = s.scalars(select(CaptureFrame)).first()
        assert f.iso is None and f.f_number is None and f.focal_mm is None
        assert s.scalars(select(CaptureSet)).one().lens is None
    facts = {f["source_key"]: f for f in api.get(f"/api/astrolog/targets/{tid}").json()["facts"]}
    assert facts["INSTRUME"]["label"] == "Camera" and facts["INSTRUME"]["value"] == "Seestar S30"
    assert facts["EXPTIME"]["label"] == "Exposure" and facts["EXPTIME"]["value"] == "10 s"
    assert not any(k.startswith("EXIF") for k in facts)


def test_i3_nights_carry_timezone_times_and_exposure(api):
    tid = seeded(api, with_stack=False)
    n = api.get(f"/api/astrolog/targets/{tid}").json()["nights"][0]
    assert n["timezone"] == "America/New_York"
    assert n["first_utc"] == "2026-09-12T03:11:24Z"
    assert n["last_utc"] == (START + timedelta(seconds=23 * 1014)).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert n["exptimes_s"] == [10.0]


def test_i3_mixed_exposures_listed(api):
    loc = make_location(api)
    a = frames_at(START, 3, exptime=10.0)
    b = frames_at(START + timedelta(minutes=5), 2, exptime=30.0, obj="NGC 7635")
    b = [{**x, "path": x["path"].replace("Light_", "Light30_")} for x in b]
    commit_chunks(api, a + b, loc)
    tid = lib_id(api)
    t = api.get(f"/api/astrolog/targets/{tid}").json()
    assert t["nights"][0]["exptimes_s"] == [10.0, 30.0]
    facts = {f["source_key"]: f["value"] for f in t["facts"]}
    assert facts["EXPTIME"] == "10 s, 30 s"


def test_i3_session_start_end_filled_from_frames_across_batches(api):
    tid = seeded(api, with_stack=False)  # 1015 frames committed in 5 batches
    sid = api.get(f"/api/astrolog/targets/{tid}").json()["nights"][0]["session_id"]
    s = api.get(f"/api/sessions/{sid}").json()
    assert s["start_utc"] == "2026-09-12T03:11:24Z"
    assert s["end_utc"] == (START + timedelta(seconds=23 * 1014)).strftime("%Y-%m-%dT%H:%M:%SZ")
    cs = s["capture_sets"][0]
    assert cs["first_utc"] == s["start_utc"] and cs["last_utc"] == s["end_utc"] and cs["exptimes_s"] == [10.0]


def test_i3_attached_plan_times_filled_only_when_null(api):
    from app.db import ObservingSession
    loc = make_location(api)
    plan = api.post("/api/sessions", json={"title": "Plan", "local_night_date": "2026-09-11", "location_id": loc}).json()
    # A plan with no times gets them from the frames, and later batches extend them.
    commit_chunks(api, ngc_frames(300), loc)
    commit_chunks(api, [sub("NGC 7635", "2026-09-12T09:59:00")], loc)
    s = api.get(f"/api/sessions/{plan['id']}").json()
    assert s["source"] == "both"
    assert s["start_utc"] == "2026-09-12T03:11:24Z" and s["end_utc"] == "2026-09-12T09:59:00Z"
    # A plan that already has times keeps them.
    other = api.post("/api/sessions", json={"title": "P2", "local_night_date": "2026-09-20", "location_id": loc}).json()
    with api.app.state.db.session() as db:
        o = db.get(ObservingSession, other["id"])
        o.start_utc, o.end_utc = "2026-09-21T01:00:00Z", "2026-09-21T02:00:00Z"
        db.commit()
    commit_chunks(api, frames_at(datetime(2026, 9, 21, 3, 0, 0, tzinfo=timezone.utc), 3), loc)
    s2 = api.get(f"/api/sessions/{other['id']}").json()
    assert s2["source"] == "both"
    assert s2["start_utc"] == "2026-09-21T01:00:00Z" and s2["end_utc"] == "2026-09-21T02:00:00Z"


def _two_customs(api):
    loc = make_location(api)
    commit(api, [sub("Blob A", "2026-09-12T03:11:24"), sub("Blob B", "2026-09-12T03:12:24"),
                 sub("Blob A", "2026-09-13T03:11:24")], loc)
    rows = {r["display_name"]: r["id"] for r in api.get(LIB).json()}
    return rows["Blob A"], rows["Blob B"]


def test_i4_custom_targets_merge_into_one_unsorted(api):
    a, b = _two_customs(api)
    ra = api.patch(f"/api/astrolog/targets/{a}", json={"kind": "unsorted"})
    assert ra.status_code == 200, ra.text
    unsorted_id = ra.json()["target"]["id"]
    assert unsorted_id != a and ra.json()["target"]["kind"] == "unsorted"
    rb = api.patch(f"/api/astrolog/targets/{b}", json={"kind": "unsorted"})
    assert rb.status_code == 200 and rb.json()["target"]["id"] == unsorted_id
    rows = api.get(LIB).json()
    uns = [r for r in rows if r["kind"] == "unsorted" or r["display_name"] == "Unsorted"]
    assert len(uns) == 1
    assert uns[0]["captured_s"] == 30.0 and uns[0]["nights"] == 2
    assert api.get(f"/api/astrolog/targets/{a}").status_code == 404
    assert api.get(f"/api/astrolog/targets/{b}").status_code == 404
    page = api.get(f"/api/astrolog/targets/{unsorted_id}").json()
    assert page["frames_total"] == 3


def test_i4_merge_respects_unique_capture_set(api):
    from app.astrolog.models import CaptureFrame
    loc = make_location(api)
    commit(api, [sub("Blob A", "2026-09-12T03:11:24")], loc)
    a = next(r["id"] for r in api.get(LIB).json() if r["display_name"] == "Blob A")
    api.patch(f"/api/astrolog/targets/{a}", json={"kind": "unsorted"})
    commit(api, [sub("Blob C", "2026-09-12T03:20:24")], loc)  # same night, same device
    c = next(r["id"] for r in api.get(LIB).json() if r["display_name"] == "Blob C")
    assert api.patch(f"/api/astrolog/targets/{c}", json={"kind": "unsorted"}).status_code == 200
    with api.app.state.db.session() as s:
        assert len(list(s.scalars(select(CaptureSet)))) == 1
        assert len(list(s.scalars(select(CaptureFrame)))) == 2


def test_i4_merge_moves_stacks_and_images(api):
    loc = make_location(api)
    commit(api, [sub("Blob A", "2026-09-12T03:11:24"), stack_item("Blob_5x10sec.fit", OBJECT="Blob A")], loc)
    a = next(r["id"] for r in api.get(LIB).json() if r["display_name"] == "Blob A")
    with api.app.state.db.session() as s:
        sid = s.scalars(select(Stack)).one().id
    upload(api, a, sid)
    r = api.patch(f"/api/astrolog/targets/{a}", json={"kind": "unsorted"}).json()
    assert r["final_image"] is not None and r["stack"]["id"] == sid and len(r["stacks"]) == 1


def test_i4_canonical_unsorted_cannot_be_patched(api):
    a, _ = _two_customs(api)
    uid = api.patch(f"/api/astrolog/targets/{a}", json={"kind": "unsorted"}).json()["target"]["id"]
    for body in ({"custom_name": "Mine"}, {"kind": "custom"}, {"kind": "unsorted"}):
        r = api.patch(f"/api/astrolog/targets/{uid}", json=body)
        assert r.status_code == 409 and r.json()["detail"] == "The Unsorted group can't be renamed."


def test_m1_no_latest_fallback_when_filename_count_contradicts(api):
    tid = seeded(api, link=False)
    b = io.BytesIO()
    Image.new("RGB", (60, 40), (5, 5, 90)).save(b, "JPEG")
    r = api.post(f"/api/astrolog/targets/{tid}/final-image", files={"file": ("NGC7635_999x10sec.jpg", b.getvalue())})
    assert r.status_code == 200
    assert api.get(f"/api/astrolog/targets/{tid}").json()["stack_suggestion_id"] is None


def test_m2_headline_basis(api):
    tid = seeded(api)
    assert api.get(f"/api/astrolog/targets/{tid}").json()["headline"]["basis"] == "linked"
    row = next(r for r in api.get(LIB).json() if r["id"] == tid)
    assert row["headline"]["basis"] == "linked"


def test_m2_m3_stack_only_basis_latest_and_nights_unknown(api):
    tid = _stack_only(api)
    row = next(r for r in api.get(LIB).json() if r["id"] == tid)
    assert row["headline"]["basis"] == "latest" and row["nights"] is None
    assert api.get(f"/api/astrolog/targets/{tid}").json()["headline"]["basis"] == "latest"
