"""Phase 3 Task 7: Sky alerts rule (spec §7.2), alert episodes and dismissals (ruling R5), alerts API.

Never touches the network: providers are fed synthetic VSX-shaped rows from ``aavso_fixtures``.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from itertools import count

import pytest
from sqlalchemy import select

from app.variables import aavso, alerts, cache
from app.variables import routes as variable_routes
from app.variables.aavso import Observation
from app.variables.catalog import get_star
from app.variables.models import VariableAlertDismissal, VariableObservation

from tests.aavso_fixtures import SENTINELS, FakeClock, RecordingFetch, VsxResponder, observers, quiet_curve, row
from tests.test_variables_aavso import provider

NOW = datetime(2026, 11, 2, 19, 0, tzinfo=timezone.utc)
NOW_JD = cache.to_jd(NOW)
SS_CYG = get_star("var:ss-cyg")
T_CRB = get_star("var:t-crb")
OK = {"last_ok_utc": "2026-11-02T18:00:00Z", "last_error": None}
PHILLY = {"lat": 39.9526, "lon": -75.1652, "date": "2026-11-02", "timezone": "America/New_York"}

_ids = count(1)


def ob(hours_ago: float, mag: float, who: str = "a", band: str = "Vis.", fainter: bool = False) -> Observation:
    return Observation(obs_id=str(next(_ids)), jd=NOW_JD - hours_ago / 24, mag=mag, uncert=None, band=band,
                       fainter_than=fainter, obs_type="Visual", val="Z", observer_hash=f"h-{who}")


@pytest.fixture(autouse=True)
def _fresh_spacing():
    aavso.reset_request_spacing()
    yield
    aavso.reset_request_spacing()


# ---------- the rule (acceptance 2) ----------

def test_one_observer_bright_is_no_change():
    r = alerts.evaluate([ob(2, 9.0, "a"), ob(5, 9.1, "a"), ob(6, 12.0, "b")], SS_CYG, NOW, OK)
    assert r["state"] == "no_change"
    assert r["evidence"] == {"observers": 1, "threshold": 10.0, "window_hours": 48, "brightest": 9.0}


def test_two_distinct_observers_within_48h_is_an_alert():
    r = alerts.evaluate([ob(2, 9.0, "a"), ob(30, 9.4, "b"), ob(40, 12.0, "c")], SS_CYG, NOW, OK)
    assert r["state"] == "alert"
    assert r["star_id"] == "var:ss-cyg" and r["normal_text"] == "quiet near 12 V"
    assert r["evidence"] == {"observers": 2, "threshold": 10.0, "window_hours": 48, "brightest": 9.0}
    assert r["current_mag"] == 9.4  # median of 9.0, 9.4, 12.0
    assert r["checked_utc"] == OK["last_ok_utc"]


def test_t_crb_needs_three_observers():
    two = [ob(1, 7.5, "a"), ob(2, 7.6, "b")]
    assert alerts.evaluate(two, T_CRB, NOW, OK)["state"] == "no_change"
    r = alerts.evaluate(two + [ob(3, 7.9, "c")], T_CRB, NOW, OK)
    assert r["state"] == "alert" and r["evidence"]["observers"] == 3 and r["evidence"]["threshold"] == 8.0


def test_bright_but_older_than_48h_is_no_change():
    r = alerts.evaluate([ob(2, 9.0, "a"), ob(49, 9.0, "b"), ob(1, 12.1, "c")], SS_CYG, NOW, OK)
    assert r["state"] == "no_change" and r["evidence"]["observers"] == 1
    assert r["current_mag"] == pytest.approx(10.55)  # 49 h old point is not in the median either


def test_only_positive_v_and_visual_detections_count():
    rows = [ob(1, 9.0, "a", fainter=True), ob(2, 9.0, "b", fainter=True),  # fainter-than limits
            ob(3, 9.0, "c", band="B"), ob(4, 9.0, "d", band="CV"),       # other bands
            ob(5, 12.0, "e", band="V")]
    r = alerts.evaluate(rows, SS_CYG, NOW, OK)
    assert r["state"] == "no_change" and r["evidence"]["observers"] == 0
    assert r["evidence"]["brightest"] == 12.0 and r["current_mag"] == 12.0
    assert alerts.evaluate([ob(1, 9.0, "a", band="V"), ob(2, 9.0, "b")], SS_CYG, NOW, OK)["state"] == "alert"


def test_no_ok_fetch_in_24h_is_stale_never_no_change():
    old = {"last_ok_utc": "2026-11-01T18:00:00Z", "last_error": None}  # 25 h before NOW
    r = alerts.evaluate([ob(30, 12.0)], SS_CYG, NOW, old)
    assert r["state"] == "stale" and r["checked_utc"] == "2026-11-01T18:00:00Z"
    failed = {"last_ok_utc": "2026-11-02T18:00:00Z", "last_error": "Could not reach VSX (ConnectError)"}
    r = alerts.evaluate([ob(1, 12.0)], SS_CYG, NOW, failed)
    assert r["state"] == "stale" and r["last_error"] == "Could not reach VSX (ConnectError)"


def test_never_fetched_is_unavailable():
    r = alerts.evaluate([], SS_CYG, NOW, {"last_ok_utc": None, "last_error": None})
    assert r["state"] == "unavailable" and r["checked_utc"] is None
    assert r["current_mag"] is None and r["evidence"]["brightest"] is None and r["evidence"]["observers"] == 0
    failed_only = {"last_ok_utc": None, "last_error": "VSX returned HTTP 503"}
    assert alerts.evaluate([], SS_CYG, NOW, failed_only)["state"] == "unavailable"


def test_alert_evidence_wins_over_staleness_and_keeps_the_fetch_time():
    old = {"last_ok_utc": "2026-11-01T18:00:00Z", "last_error": "VSX returned HTTP 503"}
    r = alerts.evaluate([ob(25, 9.0, "a"), ob(26, 9.2, "b")], SS_CYG, NOW, old)
    assert r["state"] == "alert" and r["checked_utc"] == old["last_ok_utc"] and r["last_error"]


# ---------- episodes (ruling R5) ----------

def day_obs(day: int, mag: float, n: int = 2) -> list[Observation]:
    """``n`` observations on the UT day ``day`` days before NOW's date, at 06:00 + i h."""
    base = datetime(2026, 11, 2, 6, 0, tzinfo=timezone.utc) - timedelta(days=day)
    return [Observation(obs_id=str(next(_ids)), jd=cache.to_jd(base + timedelta(hours=i)), mag=mag, uncert=None,
                        band="Vis.", fainter_than=False, obs_type="Visual", val="Z", observer_hash=f"h{i}")
            for i in range(n)]


def test_episode_starts_at_the_first_observation_of_the_bright_run_and_survives_data_gaps():
    obs = day_obs(6, 12.0) + day_obs(5, 9.0) + day_obs(3, 9.1) + day_obs(0, 9.3)  # no data on days 4, 2, 1
    start, end = alerts.episode(obs, 10.0, NOW_JD)
    assert start == pytest.approx(day_obs(5, 9.0)[0].jd) and end == pytest.approx(day_obs(0, 9.3)[-1].jd)


def test_a_full_day_at_or_fainter_than_threshold_ends_the_episode():
    obs = day_obs(4, 9.0) + day_obs(3, 10.0) + day_obs(1, 9.2) + day_obs(0, 9.1)
    start, _ = alerts.episode(obs, 10.0, NOW_JD)
    assert start == pytest.approx(day_obs(1, 9.2)[0].jd)


def test_episode_is_kept_while_todays_mean_dips_but_bright_reports_remain():
    obs = day_obs(3, 9.0) + day_obs(2, 9.2) + day_obs(1, 9.6) + day_obs(0, 10.4)
    start, _ = alerts.episode(obs, 10.0, NOW_JD)
    assert start == pytest.approx(day_obs(3, 9.0)[0].jd)


# ---------- API ----------

D0 = cache.to_jd(datetime(2026, 11, 2, tzinfo=timezone.utc))  # NOW's UT date, 00:00


def ut(day: int, hour: float) -> float:
    """JD of ``hour`` UT on the day ``day`` days after NOW's UT date."""
    return D0 + day + hour / 24


class ByStar:
    """VSX-like responder serving different synthetic rows per ``ident`` (designation)."""

    def __init__(self, rows: dict[str, list[dict]]):
        self.rows = rows

    def __call__(self, params: dict):
        return VsxResponder(self.rows.get(params["ident"], []))(params)


def bright_days(days: range, mag: str = "9.0") -> list[dict]:
    a, b = observers(2)
    return [row(ut(d, h), mag, by=w) for d in days for h, w in ((6, a), (12, b))]


@pytest.fixture
def at(monkeypatch):
    """Set the routes' clock: ``at(dt)``."""
    def _set(dt: datetime):
        monkeypatch.setattr(variable_routes, "_now", lambda: dt)
    _set(NOW)
    return _set


def client_with(make_client, clear_provider, rows: dict[str, list[dict]], fail_on: set[int] | None = None):
    fetch = RecordingFetch(ByStar(rows), fail_on=fail_on)
    return make_client(clear_provider, aavso=provider(fetch, FakeClock())), fetch


QUIET = {"SS Cyg": quiet_curve(NOW_JD - 3, 3), "U Gem": quiet_curve(NOW_JD - 3, 3, mag=14.5),
         "T CrB": quiet_curve(NOW_JD - 3, 3, mag=10.0)}


def test_alerts_off_are_disabled_and_empty(make_client, clear_provider):
    with make_client(clear_provider) as c:
        r = c.get("/api/variables/alerts", params=PHILLY)
        assert r.status_code == 200
        assert r.json()["enabled"] is False and r.json()["alerts"] == []
        assert c.post("/api/variables/ss-cyg/alerts/dismiss").status_code == 409


def test_alerts_fetch_only_the_3_day_window_for_alerting_stars_and_report_evidence(make_client, clear_provider, at):
    c, fetch = client_with(make_client, clear_provider, {**QUIET, "SS Cyg": bright_days(range(-2, 1)), "U Gem": []})
    with c:
        j = c.get("/api/variables/alerts", params=PHILLY).json()
        assert j["enabled"] is True and j["dot"] is True
        by = {a["star_id"]: a for a in j["alerts"]}
        assert list(by) == ["var:ss-cyg", "var:t-crb", "var:u-gem"]  # R Leo has no alert rule
        ss = by["var:ss-cyg"]
        assert ss["state"] == "alert" and ss["slug"] == "ss-cyg" and ss["name"] == "SS Cygni"
        assert ss["evidence"] == {"observers": 2, "threshold": 10.0, "window_hours": 48, "brightest": 9.0}
        assert ss["current_mag"] == 9.0 and ss["normal_text"] == "quiet near 12 V"
        assert ss["visibility"]["min_altitude_deg"] == 30.0 and ss["visibility"]["windows"]
        assert by["var:t-crb"]["state"] == "no_change" and by["var:t-crb"]["visibility"] is None
        assert by["var:t-crb"]["current_mag"] == pytest.approx(10.0, abs=0.1)
        assert by["var:u-gem"]["state"] == "no_change" and by["var:u-gem"]["current_mag"] is None  # nothing reported
        assert sorted(cc["ident"] for cc in fetch.calls) == ["SS Cyg", "T CrB", "U Gem"]
        assert all(hi - lo == pytest.approx(3, abs=1e-4) for lo, hi in fetch.ranges())
        assert any("AAVSO International Database" in a for a in j["attribution"])
        # A second open within 6 h makes no request (acceptance 4).
        assert c.get("/api/variables/alerts", params=PHILLY).json()["dot"] is True
        assert len(fetch.calls) == 3


def test_alert_visibility_uses_the_requested_min_altitude(make_client, clear_provider, at):
    c, _ = client_with(make_client, clear_provider, {**QUIET, "SS Cyg": bright_days(range(-2, 1))})
    with c:
        j = c.get("/api/variables/alerts", params={**PHILLY, "min_altitude_deg": 20}).json()
        ss = next(a for a in j["alerts"] if a["star_id"] == "var:ss-cyg")
        assert ss["visibility"]["min_altitude_deg"] == 20
        assert c.get("/api/variables/alerts", params={**PHILLY, "timezone": "Mars/Base"}).status_code == 422


def test_failed_alert_fetch_makes_unavailable_then_stale(make_client, clear_provider, at):
    c, fetch = client_with(make_client, clear_provider, QUIET, fail_on={1, 2, 3, 7, 8, 9})
    with c:
        states = {a["star_id"]: a["state"] for a in c.get("/api/variables/alerts", params=PHILLY).json()["alerts"]}
        assert states == {"var:ss-cyg": "unavailable", "var:u-gem": "unavailable", "var:t-crb": "unavailable"}
        at(NOW + timedelta(hours=1))  # after the 30 min backoff: succeeds
        j = c.get("/api/variables/alerts", params=PHILLY).json()
        assert {a["state"] for a in j["alerts"]} == {"no_change"} and j["dot"] is False
        at(NOW + timedelta(hours=8))  # the next refresh fails: stale, with the last good time
        j = c.get("/api/variables/alerts", params=PHILLY).json()
        ss = next(a for a in j["alerts"] if a["star_id"] == "var:ss-cyg")
        assert ss["state"] == "stale" and ss["checked_utc"].startswith("2026-11-02T20:00")
        assert ss["last_error"] == "Could not reach VSX (ConnectError)"
        assert len(fetch.calls) == 9


def test_dismiss_hides_the_episode_and_a_later_episode_alerts_again(make_client, clear_provider, at):
    a, b = observers(2)
    ss = bright_days(range(-3, 2))                                    # Oct 30 .. Nov 3 bright
    ss += [row(ut(2, h), "12.0", by=a) for h in (6, 12, 18)]           # Nov 4: a full quiet UT day
    ss += [row(ut(3, h + k / 2), "9.1", by=w) for h in (6, 12) for k, w in enumerate((a, b))]  # Nov 5: new outburst
    c, _ = client_with(make_client, clear_provider, {**QUIET, "SS Cyg": ss})
    with c:
        assert c.get("/api/variables/alerts", params=PHILLY).json()["dot"] is True
        r = c.post("/api/variables/ss-cyg/alerts/dismiss")
        assert r.status_code == 204 and r.content == b""
        j = c.get("/api/variables/alerts", params=PHILLY).json()
        assert "var:ss-cyg" not in {x["star_id"] for x in j["alerts"]} and j["dot"] is False
        with c.app.state.db.session() as s:
            [d] = s.scalars(select(VariableAlertDismissal)).all()
        # The 3-day alert window reaches back to Oct 30 19:00: the first cached bright day is Oct 31.
        assert d.star_id == "var:ss-cyg" and d.alert_since_jd == pytest.approx(ut(-2, 6), abs=1e-4)

        at(NOW + timedelta(hours=20))  # Nov 3 15:00: refreshed, same episode: still hidden
        assert c.get("/api/variables/alerts", params=PHILLY).json()["dot"] is False

        at(NOW + timedelta(days=3, hours=4))  # Nov 5 23:00: after the quiet day, a new episode alerts again
        j = c.get("/api/variables/alerts", params=PHILLY).json()
        assert next(x for x in j["alerts"] if x["star_id"] == "var:ss-cyg")["state"] == "alert" and j["dot"] is True

        assert c.post("/api/variables/ss-cyg/alerts/dismiss").status_code == 204
        with c.app.state.db.session() as s:
            [d] = s.scalars(select(VariableAlertDismissal)).all()  # one row per star, updated
        assert d.alert_since_jd == pytest.approx(ut(3, 6), abs=1e-4)
        assert c.get("/api/variables/alerts", params=PHILLY).json()["dot"] is False


def test_dismiss_requires_a_current_alert(make_client, clear_provider, at):
    c, _ = client_with(make_client, clear_provider, QUIET)
    with c:
        c.get("/api/variables/alerts", params=PHILLY)
        assert c.post("/api/variables/ss-cyg/alerts/dismiss").status_code == 409
        assert c.post("/api/variables/r-leo/alerts/dismiss").status_code == 404
        assert c.post("/api/variables/nope/alerts/dismiss").status_code == 404


def test_alert_responses_never_carry_observer_identity(make_client, clear_provider, at):
    c, _ = client_with(make_client, clear_provider, {**QUIET, "SS Cyg": bright_days(range(-2, 1))})
    with c:
        body = c.get("/api/variables/alerts", params=PHILLY).text
        assert not any(s in body for s in SENTINELS)
        with c.app.state.db.session() as s:
            hashes = set(s.scalars(select(VariableObservation.observer_hash)))
        assert hashes and not any(h in body for h in hashes)
        assert "observer_hash" not in body and "hash" not in body


def test_alerts_path_is_not_shadowed_by_star_detail(make_client, clear_provider):
    with make_client(clear_provider) as c:
        assert c.get("/api/variables/alerts").status_code == 422  # observer params are required, not a 404
