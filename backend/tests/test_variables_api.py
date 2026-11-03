"""Phase 3 Task 4: star list/detail API in fallback mode, missions, Seestar fit, AAVSO switch."""

from __future__ import annotations

import pytest

from app.main import select_aavso_mode

from .test_astrolog_import import commit, make_location, sub

VSX_SENTENCE = "Catalog data: International Variable Star Index (VSX), operated at AAVSO, Cambridge, Massachusetts, USA."


@pytest.fixture
def api(make_client, clear_provider):
    with make_client(clear_provider) as c:
        yield c


def test_select_aavso_mode():
    assert select_aavso_mode({}) == "off"
    assert select_aavso_mode({"ASTROPLANNER_AAVSO_ENABLED": "1"}) == "live"
    assert select_aavso_mode({"ASTROPLANNER_AAVSO_ENABLED": "0"}) == "off"
    assert select_aavso_mode({"ASTROPLANNER_AAVSO_FIXTURE_DIR": "/x"}) == "fixture"
    assert select_aavso_mode({"ASTROPLANNER_AAVSO_FIXTURE_DIR": ""}) == "off"
    assert select_aavso_mode({"ASTROPLANNER_AAVSO_ENABLED": "1", "ASTROPLANNER_AAVSO_FIXTURE_DIR": "/x"}) == "fixture"


def test_list_in_fallback_mode(api):
    j = api.get("/api/variables").json()
    assert j["aavso"] == {"enabled": False, "mode": "off"}
    assert len(j["stars"]) == 4
    r_leo = next(s for s in j["stars"] if s["slug"] == "r-leo")
    assert r_leo["nights_count"] == 0 and "alert" not in r_leo and r_leo["type_label"]
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


def test_attribution_and_aavso_block_in_fallback(api):
    j = api.get("/api/variables/r-leo").json()
    assert j["attribution"] == [VSX_SENTENCE]
    assert j["aavso"] == {"enabled": False, "mode": "off", "fallback_link": j["source_url"]}
    assert j["retrieved"] and j["vsx"]["name"]


def test_missions_outburst_unavailable_when_off(api):
    ms = {m["key"]: m for m in api.get("/api/variables/ss-cyg").json()["missions"]}
    assert set(ms) == {"outburst", "weekly"}
    assert ms["outburst"]["available"] is False and ms["outburst"]["reason"] == "Needs AAVSO data (off)"
    assert ms["outburst"]["progress"] == 0 and ms["outburst"]["goal"] == 3
    assert ms["weekly"]["title"] == "Weekly watch" and ms["weekly"]["unit"] == "week streak"
    cyc = {m["key"]: m for m in api.get("/api/variables/r-leo").json()["missions"]}["cycle"]
    assert (cyc["title"], cyc["goal"], cyc["unit"]) == ("Follow the cycle", 6, "months")


def test_injected_aavso_enables_and_adds_observation_attribution(make_client, clear_provider):
    with make_client(clear_provider, aavso=object()) as c:
        j = c.get("/api/variables/ss-cyg").json()
        assert j["aavso"]["enabled"] is True and j["aavso"]["mode"] == "injected"
        assert len(j["attribution"]) == 2 and j["attribution"][0] == VSX_SENTENCE
        out = {m["key"]: m for m in j["missions"]}["outburst"]
        assert out["available"] is True and out["progress"] == 0 and "reason" not in out  # Task 7 (ruling R6)
        assert c.get("/api/variables").json()["aavso"]["enabled"] is True


def test_nights_reflect_imported_ss_cyg_set(api):
    loc = make_location(api)
    # 03:11 UTC on 09-12 is the evening of 09-11 in New York.
    assert commit(api, [sub("SS Cyg", "2026-09-12T03:11:24")], loc).status_code == 200
    j = api.get("/api/variables/ss-cyg").json()
    assert j["nights"] == ["2026-09-11"]
    assert next(s for s in api.get("/api/variables").json()["stars"] if s["slug"] == "ss-cyg")["nights_count"] == 1
    assert api.get("/api/variables/r-leo").json()["nights"] == []


def test_aavso_switches_from_the_outer_environment_never_reach_a_test():
    """I1: conftest clears them, so an exported ASTROPLANNER_AAVSO_ENABLED=1 cannot make a test call VSX."""
    import os

    assert os.environ.get("ASTROPLANNER_AAVSO_ENABLED") is None
    assert os.environ.get("ASTROPLANNER_AAVSO_FIXTURE_DIR") is None


def test_a_test_can_still_turn_the_aavso_switch_on_itself(monkeypatch, make_client, clear_provider):
    monkeypatch.setenv("ASTROPLANNER_AAVSO_ENABLED", "1")
    with make_client(clear_provider) as c:
        assert c.app.state.aavso_mode == "live"  # provider built, no request made
