"""Phase 3: star list/detail API, missions, Seestar fit; no AAVSO observation endpoints."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from .conftest import client_for
from .test_astrolog_import import commit, make_location, sub

VSX_SENTENCE = "Catalog data: International Variable Star Index (VSX), operated at AAVSO, Cambridge, Massachusetts, USA."


@pytest.fixture
def api(make_client, clear_provider):
    with make_client(clear_provider) as c:
        yield c


def test_list(make_client, clear_provider):
    """Signed out: the catalog is open, but there is no personal night count (None, not 0) and no 401."""
    with make_client(clear_provider, account=None) as anon:
        r = anon.get("/api/variables")
    assert r.status_code == 200
    j = r.json()
    assert "aavso" not in j
    assert len(j["stars"]) == 4
    assert all(s["nights_count"] is None for s in j["stars"])
    r_leo = next(s for s in j["stars"] if s["slug"] == "r-leo")
    assert "alert" not in r_leo and r_leo["type_label"]
    assert r_leo["vsx"]["max_mag"] == 4.4 and r_leo["vsx"]["min_mag"] == 11.0


def test_detail_unknown_is_404_and_visibility_route_still_works(api):
    assert api.get("/api/variables/nope").status_code == 404
    assert api.get("/api/variables/r-leo/visibility", params={
        "lat": 39.9526, "lon": -75.1652, "date": "2026-11-02", "timezone": "America/New_York"}).status_code == 200


def test_seestar_fit_for_preset_only(api):
    j = api.get("/api/variables/r-leo", params={"equipment_id": "seestar-s30"}).json()
    fit = j["seestar_fit"]
    assert fit["label"] == "estimate, not yet measured" and fit["estimate_range"] == [7.0, 12.5]
    assert "too bright" in fit["text"] and "too faint" not in fit["text"]
    assert api.get("/api/variables/r-leo").json()["seestar_fit"] is None
    assert api.get("/api/variables/r-leo", params={"equipment_id": "custom-1"}).json()["seestar_fit"] is None
    ss = api.get("/api/variables/u-gem", params={"equipment_id": "seestar-s30"}).json()["seestar_fit"]
    assert "too faint" in ss["text"] and "too bright" not in ss["text"]


def test_attribution_is_the_vsx_catalog_line_only(api):
    j = api.get("/api/variables/r-leo").json()
    assert j["attribution"] == [VSX_SENTENCE]
    assert "aavso" not in j
    assert j["source_url"].startswith("https://vsx.aavso.org/index.php?view=detail.top&oid=")
    assert j["retrieved"] and j["vsx"]["name"]


def test_missions(api):
    ms = api.get("/api/variables/ss-cyg").json()["missions"]
    assert [m["key"] for m in ms] == ["weekly"]
    assert ms[0]["title"] == "Weekly watch" and ms[0]["unit"] == "week streak" and ms[0]["progress"] == 0
    cyc = {m["key"]: m for m in api.get("/api/variables/r-leo").json()["missions"]}["cycle"]
    assert (cyc["title"], cyc["goal"], cyc["unit"]) == ("Follow the cycle", 6, "months")


def test_no_aavso_observation_endpoints(api):
    """The live AAVSO layer was removed (kept on branch aavso-live-layer): only catalog/visibility routes remain."""
    paths = {p for p in api.get("/openapi.json").json()["paths"] if p.startswith("/api/variables")}
    assert paths == {"/api/variables", "/api/variables/{slug}", "/api/variables/{slug}/visibility"}
    assert api.get("/api/variables/alerts").status_code == 404  # now just an unknown star slug


def test_nights_reflect_imported_ss_cyg_set(api):
    loc = make_location(api)
    # 03:11 UTC on 09-12 is the evening of 09-11 in New York.
    assert commit(api, [sub("SS Cyg", "2026-09-12T03:11:24")], loc).status_code == 200
    j = api.get("/api/variables/ss-cyg").json()
    assert j["nights"] == ["2026-09-11"]
    assert next(s for s in api.get("/api/variables").json()["stars"] if s["slug"] == "ss-cyg")["nights_count"] == 1
    assert api.get("/api/variables/r-leo").json()["nights"] == []


def _ss_cyg(c) -> dict:
    return next(s for s in c.get("/api/variables").json()["stars"] if s["slug"] == "ss-cyg")


def test_progress_is_personal(two_users, monkeypatch):
    """Nights and mission progress come only from the signed-in user's own AstroLog; signed out, none at all."""
    # Mission "today" is Monday 2026-09-14, so Alice's night of Friday 09-11 (last week) is a 1-week streak.
    monkeypatch.setattr("app.variables.routes._now", lambda: datetime(2026, 9, 14, 16, 0, tzinfo=timezone.utc))
    alice, bob = two_users
    loc = make_location(alice)
    assert commit(alice, [sub("SS Cyg", "2026-09-12T03:11:24")], loc).status_code == 200

    assert _ss_cyg(alice)["nights_count"] == 1
    mine = alice.get("/api/variables/ss-cyg").json()
    assert mine["nights"] == ["2026-09-11"]
    assert [(m["key"], m["progress"]) for m in mine["missions"]] == [("weekly", 1)]

    assert _ss_cyg(bob)["nights_count"] == 0
    for slug in ("ss-cyg", "r-leo"):
        j = bob.get(f"/api/variables/{slug}").json()
        assert j["nights"] == []
        assert j["missions"] and all(m["progress"] == 0 for m in j["missions"]), j["missions"]

    with client_for(alice.app, None) as anon:
        assert _ss_cyg(anon)["nights_count"] is None
        for slug in ("ss-cyg", "r-leo"):
            r = anon.get(f"/api/variables/{slug}")
            assert r.status_code == 200, r.text
            j = r.json()
            assert j["nights"] == []
            assert j["missions"] and all(m["progress"] is None for m in j["missions"]), j["missions"]
            assert j["missions"][0]["title"] and j["attribution"] == [VSX_SENTENCE]
