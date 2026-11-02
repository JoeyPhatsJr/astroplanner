"""Open-Meteo forecast adapter with caching and honest missing-data handling.

Open-Meteo's free API is for non-commercial use and requires attribution
(https://open-meteo.com/en/terms). Values are model forecasts, never on-site
measurements. If retrieval fails or the night is outside the forecast range,
the adapter returns an explicit non-"ok" status; it never substitutes values.
"""

from __future__ import annotations

import threading
import time as _time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

import httpx
import numpy as np

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
HOURLY_VARS = [
    "cloud_cover",
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high",
    "precipitation_probability",
    "precipitation",
    "relative_humidity_2m",
    "dew_point_2m",
    "temperature_2m",
    "wind_speed_10m",
    "visibility",
]
DAYS_AHEAD = 15  # Open-Meteo forecast horizon (today + 15 days, verified 2026-11-02)
DAYS_BEHIND = 92  # past model data available via start_date
CACHE_TTL_S = 30 * 60
ERROR_CACHE_TTL_S = 2 * 60
USER_AGENT = "AstroPlanner/0.1 (local non-commercial prototype)"

ATTRIBUTION = {
    "provider": "Open-Meteo",
    "url": "https://open-meteo.com/",
    "terms_url": "https://open-meteo.com/en/terms",
    "license": "Data CC BY 4.0; free API for non-commercial use",
    "note": "Model forecasts (Open-Meteo 'best match' model selection), not on-site measurements.",
}


@dataclass
class Forecast:
    status: str  # ok | unavailable | error
    reason_code: str | None = None
    message: str | None = None
    retrieved_at_utc: str | None = None
    from_cache: bool = False
    grid_latitude: float | None = None
    grid_longitude: float | None = None
    grid_elevation_m: float | None = None
    times: list[int] = field(default_factory=list)  # UNIX seconds, top of hour (UTC)
    values: dict[str, list[float | None]] = field(default_factory=dict)
    units: dict[str, str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status == "ok"

    def missing_counts(self) -> dict[str, int]:
        return {k: sum(v is None for v in vals) for k, vals in self.values.items()}


Fetcher = Callable[[dict[str, Any]], httpx.Response]


def _default_fetch(params: dict[str, Any]) -> httpx.Response:
    with httpx.Client(timeout=10.0, headers={"User-Agent": USER_AGENT}) as client:
        return client.get(FORECAST_URL, params=params)


class OpenMeteoProvider:
    def __init__(self, fetch: Fetcher | None = None, now: Callable[[], datetime] | None = None):
        self._fetch = fetch or _default_fetch
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._cache: dict[tuple, tuple[float, Forecast]] = {}
        self._lock = threading.Lock()

    def clear_cache(self) -> None:
        with self._lock:
            self._cache.clear()

    def forecast(self, lat: float, lon: float, start_utc: datetime, end_utc: datetime) -> Forecast:
        start_d, end_d = start_utc.date(), end_utc.date()
        today = self._now().date()
        if start_d > today + timedelta(days=DAYS_AHEAD) or end_d > today + timedelta(days=DAYS_AHEAD):
            return Forecast(
                status="unavailable", reason_code="beyond_forecast_horizon",
                message=f"Open-Meteo forecasts extend about {DAYS_AHEAD + 1} days ahead (to {today + timedelta(days=DAYS_AHEAD)} UTC). "
                        "Astronomy for this night is still calculated.",
            )
        if start_d < today - timedelta(days=DAYS_BEHIND):
            return Forecast(
                status="unavailable", reason_code="before_forecast_archive",
                message="This night is older than the forecast API's ~3-month window; historical weather is not loaded.",
            )

        key = (round(lat, 2), round(lon, 2), start_d.isoformat(), end_d.isoformat())
        with self._lock:
            hit = self._cache.get(key)
            if hit and hit[0] > _time.monotonic():
                fc = hit[1]
                return Forecast(**{**fc.__dict__, "from_cache": True})

        fc = self._request(lat, lon, start_d, end_d)
        ttl = CACHE_TTL_S if fc.ok else ERROR_CACHE_TTL_S
        with self._lock:
            self._cache[key] = (_time.monotonic() + ttl, fc)
        return fc

    def _request(self, lat: float, lon: float, start_d: date, end_d: date) -> Forecast:
        params = {
            "latitude": round(lat, 4),
            "longitude": round(lon, 4),
            "hourly": ",".join(HOURLY_VARS),
            "timezone": "GMT",
            "timeformat": "unixtime",
            "start_date": start_d.isoformat(),
            "end_date": end_d.isoformat(),
        }
        retrieved = self._now().isoformat(timespec="seconds").replace("+00:00", "Z")
        try:
            resp = self._fetch(params)
        except httpx.HTTPError as exc:
            return Forecast(status="error", reason_code="network_error",
                            message=f"Could not reach Open-Meteo ({type(exc).__name__}).", retrieved_at_utc=retrieved)
        try:
            body = resp.json()
        except ValueError:
            body = {}
        if resp.status_code != 200 or body.get("error"):
            reason = body.get("reason") or f"HTTP {resp.status_code}"
            code = "out_of_range" if "out of allowed range" in str(reason) else "provider_error"
            return Forecast(status="unavailable" if code == "out_of_range" else "error",
                            reason_code=code, message=f"Open-Meteo: {reason}", retrieved_at_utc=retrieved)

        hourly = body.get("hourly") or {}
        times = hourly.get("time") or []
        if not times:
            return Forecast(status="error", reason_code="empty_response",
                            message="Open-Meteo returned no hourly data.", retrieved_at_utc=retrieved)
        values = {v: list(hourly.get(v) or [None] * len(times)) for v in HOURLY_VARS}
        return Forecast(
            status="ok",
            retrieved_at_utc=retrieved,
            grid_latitude=body.get("latitude"),
            grid_longitude=body.get("longitude"),
            grid_elevation_m=body.get("elevation"),
            times=[int(t) for t in times],
            values=values,
            units={k: v for k, v in (body.get("hourly_units") or {}).items() if k != "time"},
        )


def align_to_grid(fc: Forecast, grid_t: np.ndarray, max_gap_s: float = 1800.0) -> dict[str, np.ndarray] | None:
    """Map hourly values to each grid sample using the nearest hour (≤30 min away); NaN otherwise."""
    if not fc.ok or not fc.times:
        return None
    ht = np.asarray(fc.times, dtype=float)
    idx = np.clip(np.searchsorted(ht, grid_t), 1, len(ht) - 1)
    left, right = ht[idx - 1], ht[idx]
    nearest = np.where(np.abs(grid_t - left) <= np.abs(right - grid_t), idx - 1, idx)
    if len(ht) == 1:
        nearest = np.zeros_like(grid_t, dtype=int)
    gap = np.abs(ht[nearest] - grid_t)
    out: dict[str, np.ndarray] = {}
    for var, vals in fc.values.items():
        arr = np.array([np.nan if v is None else float(v) for v in vals], dtype=float)
        aligned = arr[nearest]
        aligned[gap > max_gap_s] = np.nan
        out[var] = aligned
    return out


def forecast_payload(
    fc: Forecast, span_start: float, span_end: float, now: datetime | None = None, lead_ref_ts: float | None = None
) -> dict[str, Any]:
    """API representation restricted to hours within the night span.

    ``lead_ref_ts`` is the moment the lead time is measured to (start of darkness,
    or sunset); it defaults to the span start.
    """
    now = now or datetime.now(timezone.utc)
    lead_h = ((lead_ref_ts or span_start) - now.timestamp()) / 3600
    if lead_h <= 0:
        confidence = "past_or_current"
    elif lead_h <= 24:
        confidence = "higher"
    elif lead_h <= 72:
        confidence = "moderate"
    else:
        confidence = "low"
    base = {
        "status": fc.status,
        "reason_code": fc.reason_code,
        "message": fc.message,
        "source": ATTRIBUTION,
        "retrieved_at_utc": fc.retrieved_at_utc,
        "from_cache": fc.from_cache,
        "lead_time_hours": round(lead_h, 1),
        "confidence": {
            "label": confidence,
            "kind": "heuristic",
            "explanation": "Rough label from forecast lead time to the start of darkness only (≤24 h higher, "
                           "≤72 h moderate, beyond that low). Model run time is not provided by this endpoint.",
        },
    }
    if lead_h < -12:
        base["note"] = "This night is in the past: values are archived model forecasts, not observations."
    if not fc.ok:
        return base | {"hourly": [], "missing": {}, "units": {}}
    rows = []
    sel = [i for i, t in enumerate(fc.times) if span_start - 3600 <= t <= span_end + 3600]
    for i in sel:
        rows.append({"t_ms": fc.times[i] * 1000, **{v: fc.values[v][i] for v in fc.values}})
    missing = {v: sum(fc.values[v][i] is None for i in sel) for v in fc.values}
    return base | {
        "grid": {"latitude": fc.grid_latitude, "longitude": fc.grid_longitude, "elevation_m": fc.grid_elevation_m},
        "hourly": rows,
        "missing": {k: n for k, n in missing.items() if n},
        "units": fc.units,
    }


provider = OpenMeteoProvider()
