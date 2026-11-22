"""Open-Meteo adapter: success, nulls, provider errors, horizon, caching, alignment."""

from __future__ import annotations

from datetime import datetime, timezone

import httpx
import numpy as np
import pytest

from app.weather import Forecast, OpenMeteoProvider, align_to_grid, forecast_payload, rate_limit_cooldown_s

from .conftest import FIXED_NOW, RecordingFetch, synthetic_open_meteo

START = datetime(2026, 11, 2, 17, 0, tzinfo=timezone.utc)
END = datetime(2026, 11, 3, 17, 0, tzinfo=timezone.utc)


def provider(responder):
    fetch = RecordingFetch(responder)
    return OpenMeteoProvider(fetch=fetch, now=lambda: FIXED_NOW), fetch


def test_success_parses_and_reports_missing_values():
    p, fetch = provider(lambda params: synthetic_open_meteo(params, precip=lambda i: None if i % 5 == 0 else 10.0))
    fc = p.forecast(40.0, -75.0, START, END)
    assert fc.ok and fc.times and fc.retrieved_at_utc.endswith("Z")
    assert fc.missing_counts()["precipitation_probability"] > 0
    params = fetch.calls[0]
    assert params["timezone"] == "GMT" and params["timeformat"] == "unixtime"
    assert params["start_date"] == "2026-11-02" and params["end_date"] == "2026-11-03"


def test_null_values_become_nan_never_zero():
    p, _ = provider(lambda params: synthetic_open_meteo(params, cloud=lambda i: None))
    fc = p.forecast(40.0, -75.0, START, END)
    grid = np.arange(START.timestamp(), END.timestamp(), 300.0)
    aligned = align_to_grid(fc, grid)
    assert np.all(np.isnan(aligned["cloud_cover"]))


def test_out_of_range_error_is_unavailable_not_clear():
    body = {"error": True, "reason": "Parameter 'start_date' is out of allowed range from 2026-08-01 to 2026-11-17"}
    p, _ = provider(lambda params: httpx.Response(400, json=body))
    fc = p.forecast(40.0, -75.0, START, END)
    assert fc.status == "unavailable" and fc.reason_code == "out_of_range" and not fc.values


def test_rate_limit_pauses_all_requests_for_a_while():
    body = {"error": True, "reason": "Daily API request limit exceeded. Please try again tomorrow."}
    p, fetch = provider(lambda params: httpx.Response(429, json=body))
    fc = p.forecast(40.0, -75.0, START, END)
    assert fc.status == "error" and fc.reason_code == "rate_limited" and not fc.values
    assert fc.message == "Open-Meteo: Daily API request limit exceeded. Please try again tomorrow."
    # Another place, which has no cache entry of its own, does not spend another request.
    other = p.forecast(51.5, -0.1, START, END)
    assert len(fetch.calls) == 1
    assert other.reason_code == "rate_limited" and other.from_cache


def test_rate_limit_cooldown_ends():
    body = {"error": True, "reason": "Minutely API request limit exceeded. Please try again in one minute."}
    p, fetch = provider(lambda params: httpx.Response(429, json=body) if len(fetch.calls) == 1 else synthetic_open_meteo(params))
    assert p.forecast(40.0, -75.0, START, END).reason_code == "rate_limited"
    with p._lock:
        p._rate_limited = (0.0, p._rate_limited[1])
    assert p.forecast(51.5, -0.1, START, END).ok
    assert len(fetch.calls) == 2


def test_rate_limit_pause_matches_the_limit_hit():
    # A minute's limit must not hide the weather for an hour.
    assert rate_limit_cooldown_s("Open-Meteo: Minutely API request limit exceeded. Please try again in one minute.") == 60
    assert rate_limit_cooldown_s("Open-Meteo: Hourly API request limit exceeded.") == 600
    assert rate_limit_cooldown_s("Open-Meteo: Daily API request limit exceeded. Please try again tomorrow.") == 3600
    assert rate_limit_cooldown_s("Open-Meteo: HTTP 429") == 60


def test_network_error_is_reported():
    def boom(params):
        raise httpx.ConnectTimeout("timeout")
    p, _ = provider(boom)
    fc = p.forecast(40.0, -75.0, START, END)
    assert fc.status == "error" and fc.reason_code == "network_error"


def test_beyond_horizon_short_circuits_without_request():
    p, fetch = provider(synthetic_open_meteo)
    far = datetime(2026, 12, 20, 17, tzinfo=timezone.utc)
    fc = p.forecast(40.0, -75.0, far, far)
    assert fc.status == "unavailable" and fc.reason_code == "beyond_forecast_horizon"
    assert fetch.calls == []


def test_results_are_cached():
    p, fetch = provider(synthetic_open_meteo)
    a = p.forecast(40.0, -75.0, START, END)
    b = p.forecast(40.0, -75.0, START, END)
    assert len(fetch.calls) == 1 and not a.from_cache and b.from_cache


def test_alignment_uses_nearest_hour_and_marks_gaps():
    fc = Forecast(status="ok", times=[0, 3600, 7200], values={"cloud_cover": [10.0, 50.0, 90.0]})
    grid = np.array([0.0, 1500.0, 2100.0, 7200.0, 7200.0 + 2400])
    out = align_to_grid(fc, grid)["cloud_cover"]
    assert list(out[:4]) == [10.0, 10.0, 50.0, 90.0]
    assert np.isnan(out[4])  # 40 min past the last hour: no value


def test_payload_labels_lead_time_confidence():
    fc = Forecast(status="ok", times=[int(START.timestamp())], values={"cloud_cover": [5.0]})
    near = forecast_payload(fc, START.timestamp(), END.timestamp(), FIXED_NOW, lead_ref_ts=FIXED_NOW.timestamp() + 3 * 3600)
    far = forecast_payload(fc, START.timestamp(), END.timestamp(), FIXED_NOW, lead_ref_ts=FIXED_NOW.timestamp() + 5 * 86400)
    assert near["confidence"]["label"] == "higher" and far["confidence"]["label"] == "low"
    assert near["source"]["provider"] == "Open-Meteo"


# ---- forecasts the visitor's browser fetched ("relay") ----------------------------------------------------

RELAY_START = datetime(2026, 11, 2, 17, 0, tzinfo=timezone.utc)
RELAY_END = datetime(2026, 11, 3, 17, 0, tzinfo=timezone.utc)


def _browser_body(lat=40.0, lon=-75.0, start="2026-11-01", end="2026-11-04"):
    return synthetic_open_meteo({"start_date": start, "end_date": end, "latitude": lat, "longitude": lon}).json()


def test_relayed_forecast_is_used_for_that_browser_only():
    p, fetch = provider(lambda params: httpx.Response(429, json={"error": True, "reason": "Daily API request limit exceeded."}))
    kept = p.relay("browser-aaaaaaaaaaaa", 40.0, -75.0, RELAY_START, RELAY_END, _browser_body())
    assert kept.ok
    # cut to this night's UTC dates, like the server's own request
    assert min(kept.times) >= datetime(2026, 11, 2, tzinfo=timezone.utc).timestamp()
    assert max(kept.times) < datetime(2026, 11, 4, tzinfo=timezone.utc).timestamp()
    mine = p.forecast(40.0, -75.0, RELAY_START, RELAY_END, client="browser-aaaaaaaaaaaa")
    assert mine.ok and fetch.calls == []
    other = p.forecast(40.0, -75.0, RELAY_START, RELAY_END, client="browser-bbbbbbbbbbbb")
    assert other.reason_code == "rate_limited" and len(fetch.calls) == 1


@pytest.mark.parametrize("body, why", [
    (None, "no hourly data"),
    ({"error": True, "reason": "x", "hourly": {}}, "error"),
    ("place", "another place"),
    ("short", "whole night"),
    ("string", "malformed"),
    ("bool", "malformed"),
])
def test_relayed_forecast_that_does_not_check_out_is_not_kept(body, why):
    if body == "place":
        body = _browser_body(lat=41.0)
    elif body == "short":
        body = _browser_body(start="2026-11-03", end="2026-11-04")
    elif body == "string":
        body = _browser_body()
        body["hourly"]["cloud_cover"][5] = "10"
    elif body == "bool":
        body = _browser_body()
        body["hourly"]["cloud_cover"][5] = True
    p, fetch = provider(synthetic_open_meteo)
    fc = p.relay("browser-aaaaaaaaaaaa", 40.0, -75.0, RELAY_START, RELAY_END, body)
    assert not fc.ok and fc.reason_code == "relay_rejected" and why in fc.message
    # nothing kept: the server fetches for itself
    assert p.forecast(40.0, -75.0, RELAY_START, RELAY_END, client="browser-aaaaaaaaaaaa").ok
    assert len(fetch.calls) == 1


def test_relayed_null_values_stay_missing():
    body = _browser_body()
    body["hourly"]["cloud_cover"] = [None] * len(body["hourly"]["time"])
    p, _ = provider(synthetic_open_meteo)
    fc = p.relay("browser-aaaaaaaaaaaa", 40.0, -75.0, RELAY_START, RELAY_END, body)
    assert fc.ok and all(v is None for v in fc.values["cloud_cover"])
