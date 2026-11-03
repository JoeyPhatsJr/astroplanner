"""Phase 3 Task 3: variable stars in plans, AstroLog import and explicit linking (synthetic headers)."""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.astrolog.headers import normalize_object
from app.astrolog.models import CaptureFrame, CaptureSet, LibraryTarget
from app.db import SessionTarget

from .test_astrolog_import import commit, make_location, make_plan, preview, sub

LIB = "/api/astrolog/library"
NIGHT = "2026-09-11"  # frames at 2026-09-12T03:xx UTC fall on this evening in America/New_York


@pytest.fixture
def api(make_client, clear_provider):
    with make_client(clear_provider) as c:
        yield c


def add(c, plan, target_id):
    return c.post(f"/api/sessions/{plan}/targets", json={"target_id": target_id})


def lib_row(c, **match):
    return next(r for r in c.get(LIB).json() if all(r[k] == v for k, v in match.items()))


def link(c, tid, star_id="var:ss-cyg"):
    return c.post(f"/api/astrolog/targets/{tid}/link-variable", json={"star_id": star_id})


def n_sets(c, tid=None) -> int:
    with c.app.state.db.session() as s:
        q = select(func.count()).select_from(CaptureSet)
        if tid is not None:
            q = q.where(CaptureSet.library_target_id == tid)
        return s.scalar(q)


# ---- plans ------------------------------------------------------------------------------

def test_add_variable_to_plan_and_reload(api):
    loc = make_location(api)
    plan = make_plan(api, loc)
    r = add(api, plan, "var:ss-cyg")
    assert r.status_code == 201, r.text
    s = api.get(f"/api/sessions/{plan}").json()
    assert [t["target_id"] for t in s["targets"]] == ["var:ss-cyg"]
    t = s["targets"][0]["target"]
    assert t["name"] == "SS Cygni" and t["primary_designation"] == "SS Cyg"
    assert t["kind"] == "variable" and t["category"] == "variable"
    assert add(api, plan, "var:ss-cyg").status_code == 409  # Review Focus 5
    assert add(api, plan, "var:not-a-star").status_code == 422
    assert add(api, plan, "ngc7635").status_code == 201  # DSO ids still accepted


def test_session_list_and_not_shot_with_variable(api):
    loc = make_location(api)
    planned_only = make_plan(api, loc, night="2026-09-20", title="T CrB watch")
    assert add(api, planned_only, "var:t-crb").status_code == 201
    shot = make_plan(api, loc, night=NIGHT, title="Mixed")
    assert add(api, shot, "var:t-crb").status_code == 201
    assert add(api, shot, "ngc7635").status_code == 201
    assert commit(api, [sub("NGC 7635", "2026-09-12T03:11:24")], loc).status_code == 200

    r = api.get("/api/sessions")
    assert r.status_code == 200, r.text
    by_id = {s["id"]: s for s in r.json()}
    assert by_id[planned_only]["not_shot"] == []  # nothing imported for that night yet
    assert by_id[planned_only]["targets"][0]["target"]["name"] == "T Coronae Borealis"

    night = api.get(f"/api/sessions/{shot}")
    assert night.status_code == 200, night.text
    j = night.json()
    assert j["not_shot"] == ["var:t-crb"]
    names = {t["target_id"]: t["target"] for t in j["targets"]}
    assert names["var:t-crb"]["name"] == "T Coronae Borealis"
    assert names["var:t-crb"]["primary_designation"] == "T CrB"
    assert api.get("/api/astrolog/history").status_code == 200
    assert api.get(LIB).status_code == 200


# ---- import -------------------------------------------------------------------------------

def test_import_ss_cyg_creates_variable_target_and_attaches_plan(api):
    loc = make_location(api)
    plan = make_plan(api, loc, night=NIGHT)
    assert add(api, plan, "var:ss-cyg").status_code == 201
    items = [sub("SS Cyg", f"2026-09-12T03:{m:02d}:24") for m in (11, 12, 13)]
    g = preview(api, items, location_id=loc)["groups"][0]
    assert g["target"] == {"library_key": "variable:ss-cyg", "catalog_target_id": "var:ss-cyg",
                           "display_name": "SS Cyg", "kind": "variable"}
    r = commit(api, items, loc)
    assert r.status_code == 200, r.text
    assert r.json()["session_ids"] == [plan]

    row = lib_row(api, catalog_target_id="var:ss-cyg")
    assert row["kind"] == "variable" and row["display_name"] == "SS Cygni"
    assert row["category"] == "variable" and row["custom_name"] is None
    with api.app.state.db.session() as s:
        lt = s.get(LibraryTarget, row["id"])
        assert lt.kind == "variable" and lt.catalog_target_id == "var:ss-cyg"
        assert lt.normalized_key == "variable:ss-cyg"
        st = s.scalars(select(SessionTarget).where(SessionTarget.session_id == plan)).one()
        assert st.library_target_id == row["id"]  # acceptance 7
    assert api.get(f"/api/sessions/{plan}").json()["not_shot"] == []
    assert api.get("/api/astrolog/history").json()["var:ss-cyg"]["library_target_id"] == row["id"]


def test_alias_names_resolve_to_the_same_variable_target(api):
    loc = make_location(api)
    commit(api, [sub("SS Cyg", "2026-09-12T03:11:24")], loc)
    commit(api, [sub("SS Cygni", "2026-09-13T03:11:24")], loc)
    rows = [r for r in api.get(LIB).json() if r["catalog_target_id"] == "var:ss-cyg"]
    assert len(rows) == 1 and rows[0]["nights"] == 2


def test_dso_import_unchanged(api, monkeypatch):
    from app.variables import catalog as variables

    # Even if a curated alias collided with a DSO name, the DSO catalog index is checked first.
    monkeypatch.setattr(variables, "alias_index", lambda: {normalize_object("NGC 7635"): "var:ss-cyg"})
    loc = make_location(api)
    g = preview(api, [sub("NGC 7635", "2026-09-12T03:11:24")], location_id=loc)["groups"][0]
    assert g["target"]["kind"] == "catalog" and g["target"]["catalog_target_id"] == "ngc7635"
    commit(api, [sub("NGC 7635", "2026-09-12T03:11:24")], loc)
    row = lib_row(api, catalog_target_id="ngc7635")
    assert row["kind"] == "catalog" and row["category"] != "variable"


# ---- explicit linking -----------------------------------------------------------------------

def _pre_phase3_custom(c, loc, date_obs="2026-09-12T03:11:24") -> str:
    """A custom target named "SS Cygni", as an import before the alias existed would have made it."""
    commit(c, [sub("Blob Q", date_obs)], loc)
    tid = lib_row(c, display_name="Blob Q")["id"]
    with c.app.state.db.session() as s:
        lt = s.get(LibraryTarget, tid)
        lt.custom_name, lt.normalized_key = "SS Cygni", f"custom:{normalize_object('SS Cygni')}"
        s.commit()
    return tid


def test_link_custom_target_converts(api):
    loc = make_location(api)
    tid = _pre_phase3_custom(api, loc)
    before = n_sets(api, tid)
    page_before = api.get(f"/api/astrolog/targets/{tid}").json()
    assert page_before["target"]["kind"] == "custom"

    r = link(api, tid)
    assert r.status_code == 200, r.text
    t = r.json()["target"]
    assert t["id"] == tid and t["kind"] == "variable" and t["catalog_target_id"] == "var:ss-cyg"
    assert t["display_name"] == "SS Cygni" and t["custom_name"] is None and t["category"] == "variable"
    assert r.json()["frames_total"] == page_before["frames_total"]
    assert n_sets(api, tid) == before
    with api.app.state.db.session() as s:
        assert s.get(LibraryTarget, tid).normalized_key == "variable:ss-cyg"
    # A later import of "SS Cyg" lands on the converted target, not a new one.
    commit(api, [sub("SS Cyg", "2026-09-13T03:11:24")], loc)
    assert [r["id"] for r in api.get(LIB).json() if r["catalog_target_id"] == "var:ss-cyg"] == [tid]


def test_link_merges_into_existing_variable_target(api):
    loc = make_location(api)
    commit(api, [sub("SS Cyg", "2026-09-12T03:11:24")], loc)
    var_id = lib_row(api, catalog_target_id="var:ss-cyg")["id"]
    src = _pre_phase3_custom(api, loc, date_obs="2026-09-14T03:11:24")
    plan = make_plan(api, loc, night="2026-09-20")
    assert add(api, plan, "var:ss-cyg").status_code == 201
    with api.app.state.db.session() as s:  # a plan link on the source must follow it
        s.scalars(select(SessionTarget).where(SessionTarget.session_id == plan)).one().library_target_id = src
        s.commit()
    total = n_sets(api, var_id) + n_sets(api, src)

    r = link(api, src)
    assert r.status_code == 200, r.text
    assert r.json()["target"]["id"] == var_id and r.json()["target"]["kind"] == "variable"
    assert api.get(f"/api/astrolog/targets/{src}").status_code == 404
    assert n_sets(api, var_id) == total == 2
    rows = [r for r in api.get(LIB).json() if r["catalog_target_id"] == "var:ss-cyg"]
    assert len(rows) == 1 and rows[0]["nights"] == 2
    with api.app.state.db.session() as s:
        assert s.get(LibraryTarget, src) is None
        assert s.scalar(select(func.count()).select_from(CaptureFrame)) == 2
        st = s.scalars(select(SessionTarget).where(SessionTarget.session_id == plan)).one()
        assert st.library_target_id == var_id


def test_link_rejects_catalog_and_unsorted(api):
    loc = make_location(api)
    commit(api, [sub("NGC 7635", "2026-09-12T03:11:24"), sub("SS Cyg", "2026-09-12T03:20:24"),
                 sub("Blob A", "2026-09-12T03:30:24"), sub("Blob B", "2026-09-12T03:40:24")], loc)
    cat = lib_row(api, catalog_target_id="ngc7635")["id"]
    var = lib_row(api, catalog_target_id="var:ss-cyg")["id"]
    a = lib_row(api, display_name="Blob A")["id"]
    b = lib_row(api, display_name="Blob B")["id"]
    uns = api.patch(f"/api/astrolog/targets/{a}", json={"kind": "unsorted"}).json()["target"]["id"]

    for tid in (cat, uns, var):
        assert link(api, tid).status_code == 403
    assert link(api, b, "var:not-a-star").status_code == 422
    assert api.post(f"/api/astrolog/targets/{b}/link-variable", json={}).status_code == 422
    assert link(api, "no-such-target").status_code == 404
    assert lib_row(api, id=b)["kind"] == "custom"  # rejected requests changed nothing

    for body in ({"custom_name": "Mine"}, {"kind": "unsorted"}, {"kind": "custom"}):
        assert api.patch(f"/api/astrolog/targets/{var}", json=body).status_code == 403
    assert lib_row(api, id=var)["display_name"] == "SS Cygni"
