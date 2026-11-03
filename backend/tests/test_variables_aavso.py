"""Phase 3 Task 6: AAVSO VSX provider, observation cache, salt, provider selection. Never touches the network."""

from __future__ import annotations

import hashlib
import logging
import threading
import time
from dataclasses import fields
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import func, select, text

from app.db import AppMeta, Database
from app.variables import aavso, cache
from app.variables.aavso import AavsoError, FixtureProvider, Observation, VsxProvider, parse_vsx_csv
from app.variables.catalog import get_star
from app.variables.models import VariableFetch, VariableObservation

from tests.aavso_fixtures import (
    SENTINELS, FakeClock, RecordingFetch, VsxResponder, make_csv, observers, outburst_curve, quiet_curve, row,
)

NOW = datetime(2026, 11, 2, 19, 0, tzinfo=timezone.utc)
NOW_JD = cache.to_jd(NOW)
SALT = "0123456789abcdef0123456789abcdef"
SS_CYG = get_star("var:ss-cyg")
T_CRB = get_star("var:t-crb")
UA = "AstroPlanner/0.3 (+https://github.com/JoeyPhatsJr/astroplanner; personal non-commercial)"


@pytest.fixture(autouse=True)
def _fresh_spacing():
    aavso.reset_request_spacing()
    yield
    aavso.reset_request_spacing()


@pytest.fixture
def db(tmp_path):
    d = Database(f"sqlite:///{tmp_path / 'v.db'}")
    d.init()
    return d


def provider(responder_or_fetch, clock: FakeClock | None = None) -> VsxProvider:
    clock = clock or FakeClock()
    fetch = responder_or_fetch if isinstance(responder_or_fetch, RecordingFetch) else RecordingFetch(responder_or_fetch)
    return VsxProvider(fetch=fetch, sleep=clock.sleep, clock=clock.clock, salt=SALT)


def expected_hash(code: str) -> str:
    return hashlib.sha256((SALT + code).encode()).hexdigest()[:16]


# ---------- parsing ----------

def test_parse_keeps_only_allowed_fields_and_hashes_the_observer_code():
    text_ = make_csv([row(2461000.5, "11.8", obs_id="900001", band="V", uncert="0.02", obsType="CCD", val="V")])
    [o] = parse_vsx_csv(text_, SALT)
    assert {f.name for f in fields(Observation)} == {
        "obs_id", "jd", "mag", "uncert", "band", "fainter_than", "obs_type", "val", "observer_hash"}
    assert o == Observation(obs_id="900001", jd=2461000.5, mag=11.8, uncert=0.02, band="V", fainter_than=False,
                            obs_type="CCD", val="V", observer_hash=expected_hash("ZZSEN"))
    assert not any(s in repr(o) for s in SENTINELS)


def test_parse_skips_unusable_magnitudes_and_keeps_fainter_than_with_flag():
    rows = [
        row(2461000.1, "", obs_id="1"),          # blank mag
        row(2461000.2, "<11.5", obs_id="2"),     # 'fainter than' written into mag
        row(2461000.3, "abc", obs_id="3"),       # non-numeric
        row(2461000.4, "nan", obs_id="4"),       # parses as float but is not a magnitude
        {**row(2461000.5, "12.0", obs_id="5"), "JD": "not-a-jd"},
        row(2461000.6, "13.9", obs_id="6", fainter=True),
        row(2461000.7, "12.1", obs_id="7", uncert="x"),
        row(2461000.8, "12.2", obs_id=""),       # no obsID: cannot be de-duplicated
    ]
    out = parse_vsx_csv(make_csv(rows), SALT)
    assert [o.obs_id for o in out] == ["6", "7"]
    assert out[0].fainter_than is True and out[0].mag == 13.9
    assert out[1].fainter_than is False and out[1].uncert is None


def test_distinct_observers_get_distinct_salted_hashes():
    a, b = observers(2)
    out = parse_vsx_csv(make_csv([row(2461000.1, "12", by=a, obs_id="1"), row(2461000.2, "12", by=b, obs_id="2"),
                                  row(2461000.3, "12", by=a, obs_id="3")]), SALT)
    assert out[0].observer_hash == out[2].observer_hash != out[1].observer_hash
    other = parse_vsx_csv(make_csv([row(2461000.1, "12", by=a, obs_id="1")]), "another-salt")
    assert other[0].observer_hash != out[0].observer_hash


def test_empty_body_is_no_observations_but_a_non_csv_body_is_an_error():
    assert parse_vsx_csv("", SALT) == []
    assert parse_vsx_csv(make_csv([]), SALT) == []
    with pytest.raises(AavsoError):
        parse_vsx_csv("Error: unknown star\n", SALT)


# ---------- VsxProvider ----------

def test_vsx_provider_builds_the_api_delim_request():
    fetch = RecordingFetch(VsxResponder([row(2461000.5, "12.0")]))
    out = provider(fetch).fetch_observations("SS Cyg", 2461000.0, 2461001.0)
    assert len(out) == 1
    assert fetch.calls == [{"view": "api.delim", "ident": "SS Cyg", "fromjd": "2461000.00000",
                            "tojd": "2461001.00000", "delimiter": ","}]


def test_default_http_fetch_uses_the_vsx_host_and_honest_user_agent():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, text=make_csv([]))

    p = VsxProvider(fetch=aavso.http_fetcher(httpx.MockTransport(handler)), salt=SALT)
    assert p.fetch_observations("T CrB", 2461000.0, 2461001.0) == []
    [req] = seen
    assert (req.url.scheme, req.url.host, req.url.path) == ("https", "vsx.aavso.org", "/index.php")
    assert req.headers["user-agent"] == UA == aavso.USER_AGENT
    assert dict(req.url.params) == {"view": "api.delim", "ident": "T CrB", "fromjd": "2461000.00000",
                                    "tojd": "2461001.00000", "delimiter": ","}


def test_requests_are_spaced_at_least_two_seconds_process_wide():
    clock = FakeClock()
    responder = VsxResponder([])
    p1, p2 = provider(responder, clock), provider(responder, clock)
    p1.fetch_observations("SS Cyg", 1, 2)       # first request: no wait
    p1.fetch_observations("SS Cyg", 2, 3)       # immediately after: waits the full 2 s
    clock.t += 0.5
    p2.fetch_observations("U Gem", 3, 4)        # a different provider instance shares the spacing
    clock.t += 5
    p1.fetch_observations("SS Cyg", 4, 5)       # already 5 s later: no wait
    assert clock.sleeps == [pytest.approx(2.0), pytest.approx(1.5)]


@pytest.mark.parametrize("response, message", [
    (httpx.Response(403, text="<!DOCTYPE html><title>Just a moment...</title>"), "HTTP 403"),
    (httpx.Response(503, text="busy"), "HTTP 503"),
    (httpx.Response(200, text="<html><body>challenge</body></html>"), "HTML page"),
    (httpx.Response(302, headers={"location": "https://www.aavso.org/"}), "HTTP 302"),
])
def test_vsx_errors_raise_once_without_retrying(response, message):
    fetch = RecordingFetch(lambda params: response)
    with pytest.raises(AavsoError, match=message):
        provider(fetch).fetch_observations("SS Cyg", 1, 2)
    assert len(fetch.calls) == 1


def test_network_errors_become_aavso_errors_naming_only_the_error_type():
    fetch = RecordingFetch(VsxResponder([]), fail_on={1}, fail_with=httpx.ConnectError("ZZ_SENTINEL_NAME"))
    with pytest.raises(AavsoError) as exc:
        provider(fetch).fetch_observations("SS Cyg", 1, 2)
    assert str(exc.value) == "Could not reach VSX (ConnectError)"


# ---------- FixtureProvider ----------

def test_fixture_provider_reads_the_star_slug_file_and_filters_by_jd(tmp_path):
    (tmp_path / "ss-cyg.csv").write_text(make_csv([row(2461000.5, "12.0"), row(2461002.5, "11.9")]))
    p = FixtureProvider(tmp_path, salt=SALT)
    out = p.fetch_observations("SS Cyg", 2461000.0, 2461001.0)
    assert [o.jd for o in out] == [2461000.5]
    assert out[0].observer_hash == expected_hash("ZZSEN")
    with pytest.raises(AavsoError, match="fixture"):
        p.fetch_observations("U Gem", 2461000.0, 2461001.0)  # no u-gem.csv: an explicit failure, not "no data"


# ---------- cache ----------

def recent_rows(days: int = 365, per_day: int = 2) -> list[dict]:
    return quiet_curve(NOW_JD - days, days, per_day=per_day)


def test_overlapping_alert_and_history_windows_store_each_obs_id_once(db):
    rows = recent_rows(40)
    p = provider(VsxResponder(rows))
    with db.session() as s:
        assert cache.refresh_alert_window(s, p, SS_CYG, NOW).ok
        assert cache.fill_history(s, p, SS_CYG, NOW).ok
        assert cache.refresh_alert_window(s, p, SS_CYG, NOW + timedelta(hours=7)).ok  # same 3 days again
        ids = s.scalars(select(VariableObservation.obs_id).where(VariableObservation.star_id == "var:ss-cyg")).all()
        assert len(ids) == len(set(ids)) == len(rows)
        cached = cache.cached_observations(s, "var:ss-cyg", NOW_JD - 3, NOW_JD)
        assert len(cached) == sum(1 for r in rows if float(r["JD"]) >= NOW_JD - 3)
        assert all(isinstance(o, Observation) for o in cached)


def test_alert_window_is_three_days_and_refreshes_at_most_every_six_hours(db):
    fetch = RecordingFetch(VsxResponder(recent_rows(10)))
    p = provider(fetch)
    with db.session() as s:
        first = cache.refresh_alert_window(s, p, SS_CYG, NOW)
        assert first.ok and first.requests == 1 and first.inserted > 0
        assert fetch.ranges() == [(pytest.approx(NOW_JD - 3, abs=1e-5), pytest.approx(NOW_JD, abs=1e-5))]
        again = cache.refresh_alert_window(s, p, SS_CYG, NOW + timedelta(hours=5, minutes=59))
        assert again.requests == 0 and again.skipped == "fresh"
        assert len(fetch.calls) == 1
        later = cache.refresh_alert_window(s, p, SS_CYG, NOW + timedelta(hours=6, minutes=1))
        assert later.requests == 1 and len(fetch.calls) == 2
        paths = s.scalars(select(VariableFetch.path).order_by(VariableFetch.id)).all()
        assert paths == ["alert", "alert"]  # the alert path never touches history


def test_failed_alert_fetch_is_not_retried_for_30_minutes(db):
    fetch = RecordingFetch(VsxResponder(recent_rows(10)), fail_on={1})
    p = provider(fetch)
    with db.session() as s:
        assert cache.refresh_alert_window(s, p, SS_CYG, NOW).error == "Could not reach VSX (ConnectError)"
        held = cache.refresh_alert_window(s, p, SS_CYG, NOW + timedelta(minutes=10))
        assert held.skipped == "backoff" and held.requests == 0 and len(fetch.calls) == 1
        later = cache.refresh_alert_window(s, p, SS_CYG, NOW + timedelta(minutes=31))
        assert later.ok and later.requests == 1 and len(fetch.calls) == 2


def test_concurrent_alert_refreshes_for_one_star_send_one_request(db):
    calls: list[tuple] = []
    barrier = threading.Barrier(2)

    class Slow:
        def fetch_observations(self, ident, from_jd, to_jd, timeout_s=None):
            calls.append((ident, from_jd, to_jd))
            time.sleep(0.3)
            return []

    results: list = []

    def run():
        with db.session() as s:
            barrier.wait()
            results.append(cache.refresh_alert_window(s, Slow(), SS_CYG, NOW))

    threads = [threading.Thread(target=run) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(calls) == 1
    assert sorted(r.requests for r in results) == [0, 1]


def test_status_of_the_recent_window_ignores_the_fixed_1946_window(db):
    window = (date(1946, 1, 1), date(1946, 6, 30))
    with db.session() as s:
        failing = RecordingFetch(VsxResponder([]), fail_on={1})
        assert not cache.fill_window(s, provider(failing), T_CRB, *window, now=NOW).ok
        recent = cache.status(s, "var:t-crb", NOW)
        assert (recent["last_error"], recent["last_ok_utc"]) == (None, None)
        assert cache.status(s, "var:t-crb", NOW, window=window)["last_error"] == "Could not reach VSX (ConnectError)"

        ok = RecordingFetch(VsxResponder([row(2431870.5, "3.0", obs_id="1946a")]))
        assert cache.fill_window(s, provider(ok), T_CRB, *window, now=NOW + timedelta(minutes=31)).ok
        later = NOW + timedelta(minutes=32)
        recent = cache.status(s, "var:t-crb", later)
        assert (recent["last_error"], recent["last_ok_utc"]) == (None, None)
        old = cache.status(s, "var:t-crb", later, window=window)
        assert old["last_ok_utc"] is not None and old["last_error"] is None

        assert cache.refresh_alert_window(s, provider(RecordingFetch(VsxResponder([])), FakeClock()), T_CRB, later).ok
        assert cache.status(s, "var:t-crb", later)["last_ok_utc"] is not None  # alert rows count for recent


def test_fill_history_failure_keeps_earlier_chunks_and_resumes_at_the_first_missing_chunk(db):
    rows = recent_rows()
    fetch = RecordingFetch(VsxResponder(rows), fail_on={3})
    p = provider(fetch)
    start = NOW_JD - 365
    with db.session() as s:
        res = cache.fill_history(s, p, SS_CYG, NOW)
        assert not res.ok and res.requests == 3 and res.error == "Could not reach VSX (ConnectError)"
        assert fetch.ranges()[:2] == [(pytest.approx(start), pytest.approx(start + 30)),
                                      (pytest.approx(start + 30), pytest.approx(start + 60))]
        fetches = s.scalars(select(VariableFetch).order_by(VariableFetch.id)).all()
        assert [(f.path, f.ok, f.error) for f in fetches] == [
            ("history", True, None), ("history", True, None), ("history", False, "Could not reach VSX (ConnectError)")]
        assert all(f.finished_at for f in fetches)
        n_cached = s.scalar(select(func.count()).select_from(VariableObservation))
        assert n_cached == sum(1 for r in rows if float(r["JD"]) <= start + 60)
        st = cache.status(s, "var:ss-cyg", NOW)
        assert st["last_error"] == "Could not reach VSX (ConnectError)"
        assert (st["coverage_days"], st["target_days"], st["loading"]) == (60, 365, False)
        assert st["last_ok_utc"] is not None

        backoff = RecordingFetch(VsxResponder(rows))
        held = cache.fill_history(s, provider(backoff), SS_CYG, NOW + timedelta(minutes=10))
        assert held.skipped == "backoff" and backoff.calls == []  # a failure is not retried for 30 min
        st = cache.status(s, "var:ss-cyg", NOW + timedelta(minutes=10))
        assert st["last_error"] == "Could not reach VSX (ConnectError)" and st["loading"] is False

        resume = RecordingFetch(VsxResponder(rows))
        res2 = cache.fill_history(s, provider(resume), SS_CYG, NOW + timedelta(minutes=31))
        assert res2.ok and resume.ranges()[0][0] == pytest.approx(start + 60)
        assert len(resume.calls) == 11  # chunks 3..13 (12 x 30 d + 5 d)
        st = cache.status(s, "var:ss-cyg", NOW + timedelta(minutes=31))
        assert (st["coverage_days"], st["last_error"], st["loading"]) == (365, None, False)
        assert s.scalar(select(func.count()).select_from(VariableObservation)) == len(rows)


def test_fill_history_covers_365_days_oldest_first_then_refreshes_incrementally(db):
    rows = recent_rows()
    fetch = RecordingFetch(VsxResponder(rows))
    with db.session() as s:
        assert cache.status(s, "var:ss-cyg", NOW) == {
            "last_ok_utc": None, "last_error": None, "coverage_days": 0, "target_days": 365, "loading": True}
        res = cache.fill_history(s, provider(fetch), SS_CYG, NOW)
        assert res.ok and res.requests == 13
        rng = fetch.ranges()
        assert rng[0][0] == pytest.approx(NOW_JD - 365) and rng[-1][1] == pytest.approx(NOW_JD)
        assert all(a[1] == b[0] for a, b in zip(rng, rng[1:]))  # contiguous, oldest -> newest
        assert all(hi - lo <= 30 + 1e-6 for lo, hi in rng)

        within = RecordingFetch(VsxResponder(rows))
        skipped = cache.fill_history(s, provider(within), SS_CYG, NOW + timedelta(hours=5))
        assert skipped.skipped == "fresh" and within.calls == []

        later = NOW + timedelta(hours=7)
        inc = RecordingFetch(VsxResponder(rows))
        assert cache.fill_history(s, provider(inc), SS_CYG, later).requests == 1
        max_jd = max(float(r["JD"]) for r in rows)
        assert inc.ranges() == [(pytest.approx(max_jd, abs=1e-5), pytest.approx(cache.to_jd(later), abs=1e-5))]


def test_fixed_history_window_is_fetched_once(db):
    fetch = RecordingFetch(VsxResponder([row(2431870.5, "3.0", obs_id="1946a")]))
    with db.session() as s:
        res = cache.fill_window(s, provider(fetch), T_CRB, date(1946, 1, 1), date(1946, 6, 30))
        assert res.ok and res.inserted == 1
        rng = fetch.ranges()
        assert rng[0][0] == pytest.approx(2431821.5) and rng[-1][1] == pytest.approx(2432002.5)  # 1946-07-01 0h UT
        assert len(rng) == 7
        again = cache.fill_window(s, provider(fetch), T_CRB, date(1946, 1, 1), date(1946, 6, 30))
        assert again.skipped == "covered" and len(fetch.calls) == 7
        st = cache.status(s, "var:t-crb", NOW, window=(date(1946, 1, 1), date(1946, 6, 30)))
        assert (st["coverage_days"], st["target_days"], st["loading"]) == (181, 181, False)
        # the 1946 window does not count as recent-history coverage
        assert cache.status(s, "var:t-crb", NOW)["coverage_days"] == 0


def test_no_observer_identity_in_observations_db_rows_db_file_or_logs(db, tmp_path, caplog):
    caplog.set_level(logging.DEBUG)
    rows = outburst_curve(NOW_JD - 20, 20, peak_day=17, n_observers=4)
    p = provider(VsxResponder(rows))
    with db.session() as s:
        cache.refresh_alert_window(s, p, SS_CYG, NOW)
        cache.fill_history(s, p, SS_CYG, NOW)
        obs = cache.cached_observations(s, "var:ss-cyg", NOW_JD - 400, NOW_JD)
        assert len(obs) == len(rows)
        assert len({o.observer_hash for o in obs}) == 4
        dumped = repr(obs)
        for table in ("variable_observations", "variable_fetches", "app_meta"):
            dumped += repr(s.execute(text(f"SELECT * FROM {table}")).all())
    blob = (tmp_path / "v.db").read_bytes()
    for sentinel in SENTINELS:
        assert sentinel not in dumped
        assert sentinel.encode() not in blob
        assert sentinel not in caplog.text


def test_unexpected_provider_exceptions_are_recorded_without_their_message(db):
    class Broken:
        def fetch_observations(self, ident, from_jd, to_jd, timeout_s=None):
            raise ValueError("ZZ_SENTINEL_NAME")

    with db.session() as s:
        res = cache.refresh_alert_window(s, Broken(), SS_CYG, NOW)
        assert res.error == "Unexpected error (ValueError)"
        f = s.scalars(select(VariableFetch)).one()
        assert (f.ok, f.error, f.finished_at is not None) == (False, "Unexpected error (ValueError)", True)


# ---------- salt and provider selection ----------

def test_observer_salt_is_generated_once_and_reused(db):
    with db.session() as s:
        first = cache.observer_salt(s)
    with db.session() as s:
        assert cache.observer_salt(s) == first
        assert s.get(AppMeta, "aavso_observer_salt").value == first
    assert len(first) == 32 and int(first, 16) >= 0


@pytest.mark.parametrize("env, kind, mode", [
    ({}, type(None), "off"),
    ({"ASTROPLANNER_AAVSO_ENABLED": "1"}, VsxProvider, "live"),
    ({"ASTROPLANNER_AAVSO_FIXTURE_DIR": "__tmp__"}, FixtureProvider, "fixture"),
])
def test_create_app_builds_the_provider_the_environment_asks_for(env, kind, mode, monkeypatch, tmp_path,
                                                                 make_client, clear_provider):
    monkeypatch.delenv("ASTROPLANNER_AAVSO_ENABLED", raising=False)
    monkeypatch.delenv("ASTROPLANNER_AAVSO_FIXTURE_DIR", raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, str(tmp_path) if v == "__tmp__" else v)
    with make_client(clear_provider) as c:
        assert isinstance(c.app.state.aavso, kind) and c.app.state.aavso_mode == mode
        assert c.get("/api/variables").json()["aavso"] == {"enabled": mode != "off", "mode": mode}
        if mode != "off":
            with c.app.state.db.session() as s:
                assert c.app.state.aavso.salt == cache.observer_salt(s)


def test_injected_provider_wins_over_the_environment(monkeypatch, make_client, clear_provider):
    monkeypatch.setenv("ASTROPLANNER_AAVSO_ENABLED", "1")
    fake = object()
    with make_client(clear_provider, aavso=fake) as c:
        assert c.app.state.aavso is fake and c.app.state.aavso_mode == "injected"


# ---------- final review fixes ----------

def test_a_failed_save_closes_the_fetch_row_and_backs_off_like_a_failed_request(db, monkeypatch):
    """I4: a store/commit error after a good provider call must not leave the row open (re-requested every poll)."""
    from sqlalchemy.exc import OperationalError

    real_store, calls = cache._store, []

    def store_once_broken(*args, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise OperationalError("INSERT INTO variable_observations", {}, Exception("disk I/O error"))
        return real_store(*args, **kwargs)

    monkeypatch.setattr(cache, "_store", store_once_broken)
    fetch = RecordingFetch(VsxResponder(recent_rows(30)))
    message = "Could not save AAVSO data (OperationalError)"
    with db.session() as s:
        res = cache.fill_history(s, provider(fetch), SS_CYG, NOW, days=30)
        assert not res.ok and res.error == message and res.inserted == 0 and len(fetch.calls) == 1
        f = s.scalars(select(VariableFetch)).one()
        assert (f.ok, f.rows, f.error, f.finished_at is not None) == (False, 0, message, True)
        assert s.scalar(select(func.count()).select_from(VariableObservation)) == 0
        st = cache.status(s, "var:ss-cyg", NOW, days=30)
        assert st["loading"] is False and st["last_error"] == message

        held = cache.fill_history(s, provider(fetch), SS_CYG, NOW + timedelta(minutes=10), days=30)
        assert held.skipped == "backoff" and len(fetch.calls) == 1
        later = cache.fill_history(s, provider(fetch), SS_CYG, NOW + timedelta(minutes=31), days=30)
        assert later.ok and later.requests >= 1 and len(fetch.calls) == 1 + later.requests
        assert later.inserted > 0


def test_incremental_refresh_after_a_long_observing_gap_starts_at_most_three_days_back(db):
    """M7: the newest cached observation is 265 days old; the 6-hourly refresh must not re-fetch all of that."""
    rows = quiet_curve(NOW_JD - 365, 100, per_day=2)
    with db.session() as s:
        assert cache.fill_history(s, provider(RecordingFetch(VsxResponder(rows))), SS_CYG, NOW).ok
        later = NOW + timedelta(hours=7)
        inc = RecordingFetch(VsxResponder(rows))
        res = cache.fill_history(s, provider(inc), SS_CYG, later)
        assert res.ok and res.requests == 1
        assert inc.ranges() == [(pytest.approx(NOW_JD - cache.ALERT_DAYS, abs=1e-5),
                                 pytest.approx(cache.to_jd(later), abs=1e-5))]


def test_alert_requests_use_a_shorter_timeout_than_history_requests(db):
    """M8: a hanging VSX must not hold the Tonight card for a minute per star."""
    assert (aavso.ALERT_TIMEOUT_S, aavso.TIMEOUT_S) == (15.0, 60.0)
    fetch = RecordingFetch(VsxResponder(recent_rows(10)))
    p = provider(fetch)
    with db.session() as s:
        assert cache.refresh_alert_window(s, p, SS_CYG, NOW).ok
        assert cache.fill_history(s, p, SS_CYG, NOW, days=30).ok
    assert fetch.timeouts == [aavso.ALERT_TIMEOUT_S, aavso.TIMEOUT_S]


def test_http_fetcher_applies_the_requested_timeout():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, text=make_csv([]))

    p = VsxProvider(fetch=aavso.http_fetcher(httpx.MockTransport(handler)), salt=SALT)
    p.fetch_observations("T CrB", 2461000.0, 2461001.0, timeout_s=aavso.ALERT_TIMEOUT_S)
    p.fetch_observations("T CrB", 2461000.0, 2461001.0)
    assert [r.extensions["timeout"]["read"] for r in seen] == [15.0, 60.0]
