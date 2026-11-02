"""Open-Meteo adapter: success, nulls, provider errors, horizon, caching, alignment."""

from __future__ import annotations

from datetime import datetime, timezone

import httpx
import numpy as np

from app.weather import Forecast, OpenMeteoProvider, align_to_grid, forecast_payload

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
