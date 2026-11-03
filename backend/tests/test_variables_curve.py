"""Phase 3 Task 7: light-curve endpoint (background history fill), outburst mission from the cache,
observer-timezone "today" for missions (ruling R7). Never touches the network."""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from sqlalchemy import select

from app.variables import aavso, cache, curve, missions
from app.variables import routes as variable_routes
from app.variables.catalog import get_star
from app.variables.models import VariableObservation

from tests.aavso_fixtures import (
    SENTINELS, FakeClock, RecordingFetch, VsxResponder, observers, outburst_curve, quiet_curve, row,
)
from tests.test_astrolog_import import commit, make_location, sub
from tests.test_variables_aavso import provider

NOW = datetime(2026, 11, 2, 19, 0, tzinfo=timezone.utc)
NOW_JD = cache.to_jd(NOW)
D0 = cache.to_jd(datetime(2026, 11, 2, tzinfo=timezone.utc))
SS_CYG = get_star("var:ss-cyg")
OBS_SENTENCE = "Observations from the AAVSO International Database, contributed by observers worldwide. © AAVSO."


@pytest.fixture(autouse=True)
def _fresh_spacing():
    aavso.reset_request_spacing()
    yield
    aavso.reset_request_spacing()


@pytest.fixture
def at(monkeypatch):
    def _set(dt: datetime):
        monkeypatch.setattr(variable_routes, "_now", lambda: dt)
    _set(NOW)
    return _set


def client_with(make_client, clear_provider, rows: list[dict], fail_on: set[int] | None = None):
    fetch = RecordingFetch(VsxResponder(rows), fail_on=fail_on)
    return make_client(clear_provider, aavso=provider(fetch, FakeClock())), fetch


def mixed_rows() -> list[dict]:
    """Quiet SS Cyg over 60 days, plus rows that must never be plotted."""
    a, b = observers(2)
    rows = quiet_curve(NOW_JD - 60, 60, per_day=3)
    rows += [row(NOW_JD - 10.3, "13.8", by=a, fainter=True), row(NOW_JD - 9.3, "11.2", by=b, band="B"),
             row(NOW_JD - 8.3, "11.9", by=a, band="V"), row(NOW_JD - 7.3, "12.1", by=b, band="CV")]
    return rows


def expected_points(rows: list[dict]) -> list[list]:
    keep = [r for r in rows if r["fainterThan"] == "0" and r["band"] in ("V", "Vis.")]
    return sorted([round(float(r["JD"]), 5), float(r["mag"]), r["band"]] for r in keep)


# ---------- unit ----------

def test_downsample_keeps_every_nth():
    assert curve.downsample(list(range(10)), 10) == (list(range(10)), 1)
    pts, n = curve.downsample(list(range(3001)), 3000)
    assert n == 2 and len(pts) == 1501 and pts[:3] == [0, 2, 4]
    assert curve.downsample([], 3000) == ([], 1)


def test_daily_means_group_by_ut_date():
    pts = [(D0 + 0.1, 12.0), (D0 + 0.9, 11.0), (D0 + 1.2, 9.0)]
    out = curve.daily_means(pts)
    assert [(d.day, d.mean, d.n) for d in out] == [(date(2026, 11, 2), 11.5, 2), (date(2026, 11, 3), 9.0, 1)]
    assert out[0].first_jd == pytest.approx(D0 + 0.1) and out[0].last_jd == pytest.approx(D0 + 0.9)


def test_outburst_windows_are_runs_of_consecutive_bright_days():
    pts = [(D0 + d + 0.5, m) for d, m in [(0, 12.0), (1, 9.0), (2, 9.5), (3, 10.0), (4, 9.0), (6, 9.0)]]
    w = missions.outburst_windows(curve.daily_means(pts), 10.0)
    assert w == [(date(2026, 11, 3), date(2026, 11, 4)), (date(2026, 11, 6), date(2026, 11, 6)),
                 (date(2026, 11, 8), date(2026, 11, 8))]  # 10.0 is not brighter; a missing day ends a run


# ---------- curve endpoint ----------

def test_curve_is_409_when_aavso_is_off(make_client, clear_provider):
    with make_client(clear_provider) as c:
        r = c.get("/api/variables/ss-cyg/curve")
        assert r.status_code == 409 and "AAVSO" in r.json()["detail"]


def test_curve_returns_the_cache_now_and_fills_history_in_the_background(make_client, clear_provider, at):
    rows = mixed_rows()
    c, fetch = client_with(make_client, clear_provider, rows)
    with c:
        first = c.get("/api/variables/ss-cyg/curve").json()
        # Built before any request to AAVSO: nothing cached yet, loading, a fill scheduled.
        assert first["points"] == [] and first["daily"] == [] and first["status"]["loading"] is True
        assert first["counts"] == {"cached": 0, "plotted_points": 0, "every_nth": 1, "included": 0}
        assert len(fetch.calls) == 13  # the background fill ran after the response (TestClient runs it inline)

        j = c.get("/api/variables/ss-cyg/curve").json()
        assert j["points"] == expected_points(rows)  # acceptance 1
        assert j["counts"] == {"cached": len(rows), "plotted_points": len(expected_points(rows)), "every_nth": 1,
                               "included": len(expected_points(rows))}
        assert j["bands_included"] == ["V", "Vis."]
        assert j["excluded_note"] == "Fainter-than estimates and other bands are not plotted."
        assert j["attribution"][1] == OBS_SENTENCE
        assert j["status"]["loading"] is False and j["status"]["last_ok_utc"].startswith("2026-11-02T19:00")
        assert j["status"]["coverage_days"] == 365 and j["window"]["key"] == "recent"
        assert all(len(d) == 3 for d in j["daily"]) and sum(n for *_, n in j["daily"]) == len(expected_points(rows))
        assert [d for d, *_ in j["daily"]] == sorted({d for d, *_ in j["daily"]})
        day, mean, n = j["daily"][-1]
        assert day == "2026-11-02" and 11.5 < mean < 12.5 and n >= 1
        assert len(fetch.calls) == 13  # fresh: the scheduled fill made no request


def test_curve_request_schedules_exactly_one_fill_and_never_calls_the_provider_itself(
        make_client, clear_provider, at, monkeypatch):
    scheduled: list[tuple] = []
    monkeypatch.setattr(curve, "run_fill", lambda *a: scheduled.append(a))
    c, fetch = client_with(make_client, clear_provider, mixed_rows())
    with c:
        j = c.get("/api/variables/ss-cyg/curve").json()
        assert j["status"]["loading"] is True and fetch.calls == []
        assert len(scheduled) == 1
        _db, prov, star, window, now = scheduled[0]
        assert prov is c.app.state.aavso and star["id"] == "var:ss-cyg" and window.key == "recent" and now == NOW


def test_curve_points_are_down_sampled_above_3000(make_client, clear_provider, at):
    rows = quiet_curve(NOW_JD - 100, 100, per_day=31)  # 3100 positive visual detections
    c, _ = client_with(make_client, clear_provider, rows)
    with c:
        c.get("/api/variables/ss-cyg/curve")
        j = c.get("/api/variables/ss-cyg/curve").json()
        assert j["counts"]["cached"] == 3100 and j["counts"]["every_nth"] == 2
        assert j["counts"]["plotted_points"] == len(j["points"]) == 1550
        assert j["points"] == expected_points(rows)[::2]
        assert sum(n for _, _, n in j["daily"]) == 3100  # daily means use every observation


def test_curve_after_a_failed_fill_is_not_loading_and_says_why(make_client, clear_provider, at):
    c, fetch = client_with(make_client, clear_provider, mixed_rows(), fail_on={3})
    with c:
        c.get("/api/variables/ss-cyg/curve")
        j = c.get("/api/variables/ss-cyg/curve").json()
        assert j["status"]["loading"] is False and j["status"]["last_error"] == "Could not reach VSX (ConnectError)"
        assert len(fetch.calls) == 3  # in backoff: the second request's fill did not retry


def test_t_crb_1946_window(make_client, clear_provider, at):
    eruption = cache.to_jd(datetime(1946, 2, 9, tzinfo=timezone.utc))
    rows = [row(eruption + d + k / 10, f"{2.5 + 0.3 * d:.1f}", by=w) for d in range(10)
            for k, w in enumerate(observers(2))]
    c, fetch = client_with(make_client, clear_provider, rows)
    with c:
        c.get("/api/variables/t-crb/curve", params={"window": "1946"})
        lo, hi = cache._window_jd("1946-01-01", "1946-06-30")
        assert all(lo - 1e-6 <= a and b <= hi + 1e-6 for a, b in fetch.ranges()) and len(fetch.calls) == 7
        j = c.get("/api/variables/t-crb/curve", params={"window": "1946"}).json()
        assert len(j["points"]) == 20 and j["window"] == {"key": "1946", "label": "1946 eruption",
                                                          "from_date": "1946-01-01", "to_date": "1946-06-30"}
        assert j["status"]["loading"] is False and j["status"]["target_days"] == 181
        assert c.get("/api/variables/t-crb/curve", params={"window": "1999"}).status_code == 422
        assert c.get("/api/variables/r-leo/curve", params={"window": "1946"}).status_code == 422
        assert c.get("/api/variables/nope/curve").status_code == 404


def test_curve_responses_never_carry_observer_identity(make_client, clear_provider, at):
    c, _ = client_with(make_client, clear_provider, mixed_rows())
    with c:
        c.get("/api/variables/ss-cyg/curve")
        body = c.get("/api/variables/ss-cyg/curve").text
        assert not any(s in body for s in SENTINELS) and "hash" not in body
        with c.app.state.db.session() as s:
            hashes = set(s.scalars(select(VariableObservation.observer_hash)))
        assert hashes and not any(h in body for h in hashes)


# ---------- missions ----------

def shoot(c, loc: str, utc: str):
    assert commit(c, [sub("SS Cyg", utc)], loc).status_code == 200


def test_catch_an_outburst_counts_nights_inside_the_cached_outburst_only(make_client, clear_provider, at):
    # Quiet from Oct 3, outburst peaking Oct 16: daily means brighter than 10.0 on Oct 16-19 UT only.
    start = cache.to_jd(datetime(2026, 10, 3, tzinfo=timezone.utc))
    rows = outburst_curve(start, 30, peak_day=13)
    c, _ = client_with(make_client, clear_provider, rows)
    with c:
        loc = make_location(c)
        shoot(c, loc, "2026-10-17T02:00:00")  # local night Oct 16: inside
        shoot(c, loc, "2026-10-19T03:00:00")  # local night Oct 18: inside
        shoot(c, loc, "2026-10-29T03:00:00")  # local night Oct 28: outside the outburst
        c.get("/api/variables/ss-cyg/curve")  # fills the history cache
        ms = {m["key"]: m for m in c.get("/api/variables/ss-cyg").json()["missions"]}
        out = ms["outburst"]
        assert out["available"] is True and out["progress"] == 2 and out["goal"] == 3
        assert "reason" not in out and "10.0" in out["note"]


def test_catch_an_outburst_is_available_with_no_data_yet(make_client, clear_provider, at):
    c, _ = client_with(make_client, clear_provider, [])
    with c:
        out = {m["key"]: m for m in c.get("/api/variables/u-gem").json()["missions"]}["outburst"]
        assert out["available"] is True and out["progress"] == 0


def test_mission_today_follows_the_observer_timezone(make_client, clear_provider, monkeypatch):
    # 2026-11-02 03:00 UTC is Monday in UTC (ISO week 45) but Sunday Nov 1 in New York (week 44).
    monkeypatch.setattr(variable_routes, "_now", lambda: datetime(2026, 11, 2, 3, 0, tzinfo=timezone.utc))
    with make_client(clear_provider) as c:
        loc = make_location(c)
        shoot(c, loc, "2026-10-21T03:00:00")  # local night Tue Oct 20 (week 43)

        def weekly(**params) -> int:
            r = c.get("/api/variables/ss-cyg", params=params)
            assert r.status_code == 200
            return {m["key"]: m for m in r.json()["missions"]}["weekly"]["progress"]

        assert weekly(timezone="America/New_York") == 1  # this week (44) empty, last week (43) has a night
        assert weekly() == 0  # UTC: week 45, so week 44 is "last week" and is empty
        assert weekly(timezone="UTC") == 0
        assert c.get("/api/variables/ss-cyg", params={"timezone": "Not/AZone"}).status_code == 422
        assert c.get("/api/variables", params={"timezone": "America/New_York"}).status_code == 200
        assert c.get("/api/variables", params={"timezone": "Not/AZone"}).status_code == 422


def test_curve_and_alerts_payloads_say_which_aavso_source_they_come_from(make_client, clear_provider, at, tmp_path):
    """I2: the frontend must be able to tell synthetic fixture data from real AAVSO observations."""
    from app.variables.aavso import FixtureProvider
    from tests.conftest import PHILLY_PARAMS

    with make_client(clear_provider) as c:
        assert c.get("/api/variables/alerts", params=PHILLY_PARAMS).json()["mode"] == "off"
    c, _ = client_with(make_client, clear_provider, quiet_curve(NOW_JD - 5, 5))  # a VsxProvider (fake fetch)
    with c:
        assert c.get("/api/variables/ss-cyg/curve").json()["mode"] == "live"
        assert c.get("/api/variables/alerts", params=PHILLY_PARAMS).json()["mode"] == "live"
    with make_client(clear_provider, db_path=tmp_path / "fx.db", aavso=FixtureProvider(tmp_path, salt="s")) as c:
        assert c.get("/api/variables/ss-cyg/curve").json()["mode"] == "fixture"
        assert c.get("/api/variables/alerts", params=PHILLY_PARAMS).json()["mode"] == "fixture"
