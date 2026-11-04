"""Phase 4 Task 2: processing runs table, run API, step skeleton and the first advice rules."""

from __future__ import annotations

from typing import get_args

import pytest
from sqlalchemy import select

from app.astrolog.models import CaptureFrame, CaptureSet
from app.processing.models import ProcessingRun
from app.processing.rules import RULES, Basis, Facts, advice_for
from app.processing.steps import STEP_ORDER

from .astrolog_fixtures import seestar_sub_header
from .test_astrolog_import import COMMIT, commit, cr2_item, fits_item, make_location, ngc_subs
from .test_variables_plans_astrolog import link, lib_row

RUNS = "/api/processing/runs"


@pytest.fixture
def api(make_client, clear_provider):
    with make_client(clear_provider) as c:
        yield c


def seestar_night(c, loc, minutes=(11, 12, 13), **header):
    items = [fits_item(f"Light_{m}.fit", seestar_sub_header(date_obs=f"2026-09-12T03:{m:02d}:24", **header))
             for m in minutes]
    r = commit(c, items, loc)
    assert r.status_code == 200, r.text


def only_set_id(c) -> str:
    with c.app.state.db.session() as s:
        return s.scalars(select(CaptureSet)).first().id


def make_run(c) -> dict:
    r = c.post(RUNS, json={"capture_set_id": only_set_id(c)})
    assert r.status_code in (200, 201), r.text
    return r.json()


def test_create_run_is_idempotent(api):
    loc = make_location(api)
    seestar_night(api, loc)
    cs = only_set_id(api)
    a = api.post(RUNS, json={"capture_set_id": cs}).json()
    b = api.post(RUNS, json={"capture_set_id": cs}).json()
    assert a["id"] == b["id"] and a["capture_set_id"] == cs
    assert a["frames"] == 3 and a["exptime_s"] == 10.0 and a["siril_target"] == "1.4.5"
    assert a["night"]["night_date"] == "2026-09-11" and a["night"]["timezone"] == "America/New_York"
    assert a["target"]["name"]
    assert a["report"] is None and a["selection"] == [] and a["comparison"] == {}
    assert api.get(f"{RUNS}/{a['id']}").json()["id"] == a["id"]
    assert api.get(f"{RUNS}/nope").status_code == 404


def test_unknown_set_404(api):
    assert api.post(RUNS, json={"capture_set_id": "nope"}).status_code == 404


def test_run_rejects_non_seestar(api):
    loc = make_location(api)
    assert commit(api, [cr2_item("IMG_1.CR2", "2026:08:12 22:19:50")], loc).status_code == 200
    r = api.post(RUNS, json={"capture_set_id": only_set_id(api)})
    assert r.status_code == 422
    assert r.json()["detail"] == "The coach supports Seestar S30 FITS nights only."


def test_run_steps_in_mockup_order(api):
    loc = make_location(api)
    seestar_night(api, loc)
    run = make_run(api)
    assert [s["id"] for s in run["steps"]] == list(STEP_ORDER)
    assert [s["n"] for s in run["steps"]] == list(range(1, 11))
    assert run["steps"][0]["title"] == "Night report"
    # Phase 4 Task 6 reworded this: step 1 now offers both an existing Siril run and the coach's first script.
    blocked = run["steps"][0]["blocked"]
    assert "already holds a Siril run" in blocked and "first script" in blocked
    for s in run["steps"]:
        assert s["does"] and s["gui"] and s["state"] == "todo"


def test_patch_step_state_persists(api):
    loc = make_location(api)
    seestar_night(api, loc)
    run = make_run(api)
    r = api.patch(f"{RUNS}/{run['id']}", json={"step_states": {"convert": "done"}})
    assert r.status_code == 200, r.text
    assert api.get(f"{RUNS}/{run['id']}").json()["steps"][1]["state"] == "done"
    assert api.patch(f"{RUNS}/{run['id']}", json={"step_states": {"bogus": "done"}}).status_code == 422
    assert api.patch(f"{RUNS}/{run['id']}", json={"step_states": {"align": "maybe"}}).status_code == 422
    after = api.patch(f"{RUNS}/{run['id']}", json={"choices": {"filter": "round"}}).json()
    assert after["steps"][1]["state"] == "done"  # earlier state kept
    with api.app.state.db.session() as s:
        assert s.scalars(select(ProcessingRun)).one().choices == {"filter": "round"}


def test_every_rule_has_basis():
    assert RULES
    for r in RULES:
        assert r.basis in get_args(Basis)
        if r.basis == "siril-docs":
            assert r.source_url and r.source_url.startswith("https://")


def test_convert_advice_uses_bayer_from_header():
    a = advice_for("convert", Facts(bayer_pattern="GRBG", frame_count=3, exptime_s=10))[0]
    assert "GRBG" in a.setting and a.basis == "measured" and a.heuristic is False
    b = advice_for("convert", Facts(bayer_pattern=None, frame_count=3, exptime_s=10))[0]
    assert b.basis == "siril-docs" and b.source_url.startswith("https://")
    assert advice_for("align", Facts(bayer_pattern="GRBG", frame_count=3, exptime_s=10)) == []


def test_import_stores_bayer_pattern(api):
    loc = make_location(api)
    seestar_night(api, loc, minutes=(11,), BAYERPAT="GRBG")
    seestar_night(api, loc, minutes=(12,), BAYERPAT="junk!")
    seestar_night(api, loc, minutes=(13,))
    with api.app.state.db.session() as s:
        got = {f.date_obs_utc[11:16]: f.bayer_pattern for f in s.scalars(select(CaptureFrame))}
    assert got == {"03:11": "GRBG", "03:12": None, "03:13": None}


def test_mixed_patterns_fall_back_to_docs_advice(api):
    loc = make_location(api)
    seestar_night(api, loc, minutes=(11,), BAYERPAT="GRBG")
    seestar_night(api, loc, minutes=(12,), BAYERPAT="RGGB")
    conv = make_run(api)["steps"][1]["advice"][0]
    assert conv["basis"] == "siril-docs" and conv["source_url"].startswith("https://")
    assert conv["rule_id"] == "convert.debayer"


def test_run_advice_measured_from_headers(api):
    loc = make_location(api)
    seestar_night(api, loc, BAYERPAT="GRBG")
    conv = make_run(api)["steps"][1]["advice"][0]
    assert "GRBG" in conv["setting"] and conv["basis"] == "measured"


def test_target_nights_carry_capture_set_id(api):
    loc = make_location(api)
    seestar_night(api, loc)
    run = make_run(api)
    tid = run["target"]["id"]
    nights = api.get(f"/api/astrolog/targets/{tid}").json()["nights"]
    assert nights[0]["capture_set_id"] == run["capture_set_id"]


def _set_of(c, tid) -> str:
    with c.app.state.db.session() as s:
        return s.scalars(select(CaptureSet).where(CaptureSet.library_target_id == tid)).one().id


def test_merge_moves_run(api):
    """Merging a target into one with no set for that night just re-parents the set; the run stays on it."""
    loc = make_location(api)
    commit(api, [fits_item("a.fit", seestar_sub_header(object="SS Cyg", date_obs="2026-09-13T03:11:24"))], loc)
    var_id = lib_row(api, catalog_target_id="var:ss-cyg")["id"]
    commit(api, [fits_item("b.fit", seestar_sub_header(object="Blob Q", date_obs="2026-09-12T03:21:24"))], loc)
    src = lib_row(api, display_name="Blob Q")["id"]
    run = api.post(RUNS, json={"capture_set_id": _set_of(api, src)}).json()
    assert link(api, src).status_code == 200
    got = api.get(f"{RUNS}/{run['id']}").json()
    assert got["capture_set_id"] == run["capture_set_id"] and got["target"]["id"] == var_id


def test_merge_moves_run_into_existing_set(api):
    """Same night + device on both targets: frames join the surviving set and the run is re-pointed to it."""
    loc = make_location(api)
    commit(api, [fits_item("a.fit", seestar_sub_header(object="SS Cyg", date_obs="2026-09-12T03:11:24"))], loc)
    var_id = lib_row(api, catalog_target_id="var:ss-cyg")["id"]
    commit(api, [fits_item("b.fit", seestar_sub_header(object="Blob Q", date_obs="2026-09-12T03:21:24"))], loc)
    src = lib_row(api, display_name="Blob Q")["id"]
    run = api.post(RUNS, json={"capture_set_id": _set_of(api, src)}).json()
    surviving = _set_of(api, var_id)
    assert link(api, src).status_code == 200
    got = api.get(f"{RUNS}/{run['id']}").json()
    assert got["capture_set_id"] == surviving and got["target"]["id"] == var_id
    assert got["frames"] == 2


def test_merge_conflict_409(api):
    loc = make_location(api)
    commit(api, [fits_item("a.fit", seestar_sub_header(object="SS Cyg", date_obs="2026-09-12T03:11:24"))], loc)
    var_id = lib_row(api, catalog_target_id="var:ss-cyg")["id"]
    commit(api, [fits_item("b.fit", seestar_sub_header(object="Blob Q", date_obs="2026-09-12T03:21:24"))], loc)
    src = lib_row(api, display_name="Blob Q")["id"]
    ra = api.post(RUNS, json={"capture_set_id": _set_of(api, var_id)}).json()
    rb = api.post(RUNS, json={"capture_set_id": _set_of(api, src)}).json()
    r = link(api, src)
    assert r.status_code == 409 and "run" in r.json()["detail"].lower()
    # Nothing moved: both runs and the source target survive.
    assert api.get(f"{RUNS}/{ra['id']}").json()["capture_set_id"] == ra["capture_set_id"]
    assert api.get(f"{RUNS}/{rb['id']}").json()["capture_set_id"] == rb["capture_set_id"]
    assert api.get(f"/api/astrolog/targets/{src}").status_code == 200
