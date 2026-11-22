"""Open-Meteo forecast adapter with caching and honest missing-data handling.

Open-Meteo's free API is for non-commercial use and requires attribution
(https://open-meteo.com/en/terms). Values are model forecasts, never on-site
measurements. If retrieval fails or the night is outside the forecast range,
the adapter returns an explicit non-"ok" status; it never substitutes values.
"""

from __future__ import annotations

import re
import threading
import time as _time
from collections import OrderedDict
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
# Open-Meteo's free API limits requests per IP (per minute, hour and day). Once it says a limit is reached,
# every further request from this server fails the same way, so stop asking until that limit can have reset
# instead of retrying each place every two minutes. A minute's limit pauses for a minute, not an hour, so a
# short burst never hides the weather for long. On a host whose outbound IP is shared (Render's free tier),
# other services spend the same quota.
RATE_LIMIT_COOLDOWN_S = {"minutely": 60, "hourly": 10 * 60, "daily": 60 * 60}
RATE_LIMIT_DEFAULT_COOLDOWN_S = 60


def rate_limit_cooldown_s(message: str | None) -> int:
    """How long to stop asking Open-Meteo after a rate-limit answer, by which limit it names."""
    text = (message or "").lower()
    for period, seconds in RATE_LIMIT_COOLDOWN_S.items():
        if period in text:
            return seconds
    return RATE_LIMIT_DEFAULT_COOLDOWN_S
USER_AGENT = "AstroPlanner/0.1 (local non-commercial prototype)"
# The visitor's browser can fetch the forecast from Open-Meteo itself and hand the answer over ("relay"), so the
# request counts against the visitor's own IP, not this server's shared one. A relayed forecast is kept for that
# browser only: one visitor can never change what another sees.
RELAY_TTL_S = CACHE_TTL_S
RELAY_MAX_ENTRIES = 2000
RELAY_MAX_GRID_OFFSET_DEG = 0.5  # Open-Meteo snaps to its model grid; anything farther is another place
CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9-]{16,64}$")

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


def parse_response(status_code: int, body: Any, retrieved: str) -> Forecast:
    """Turn an Open-Meteo answer, fetched here or by the visitor's browser, into a Forecast."""
    if not isinstance(body, dict):
        body = {}
    if status_code != 200 or body.get("error"):
        reason = body.get("reason") or f"HTTP {status_code}"
        if "out of allowed range" in str(reason):
            code = "out_of_range"
        elif status_code == 429 or "limit exceeded" in str(reason).lower():
            code = "rate_limited"
        else:
            code = "provider_error"
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


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and np.isfinite(v)


def relayed_forecast(body: Any, lat: float, lon: float, start_utc: datetime, end_utc: datetime,
                     retrieved: str) -> Forecast:
    """Check an Open-Meteo answer that the visitor's browser fetched and cut it to this night's UTC dates.

    The answer must be for this place (Open-Meteo's grid point within RELAY_MAX_GRID_OFFSET_DEG), carry every
    variable this app uses as numbers or nulls on whole UTC hours, and cover the whole night.
    """
    def refuse(why: str) -> Forecast:
        return Forecast(status="error", reason_code="relay_rejected", message=f"Browser forecast not used: {why}.",
                        retrieved_at_utc=retrieved)

    if not isinstance(body, dict) or not isinstance(body.get("hourly"), dict):
        return refuse("no hourly data")
    if body.get("error"):
        return refuse("Open-Meteo answered with an error")
    if not (_is_number(body.get("latitude")) and _is_number(body.get("longitude"))):
        return refuse("no grid position")
    if (abs(body["latitude"] - lat) > RELAY_MAX_GRID_OFFSET_DEG
            or abs((body["longitude"] - lon + 180) % 360 - 180) > RELAY_MAX_GRID_OFFSET_DEG):
        return refuse("forecast is for another place")
    hourly = body["hourly"]
    times = hourly.get("time")
    if not isinstance(times, list) or not times or len(times) > 24 * 40:
        return refuse("no usable hours")
    if not all(isinstance(t, int) and not isinstance(t, bool) and t % 3600 == 0 for t in times):
        return refuse("hours are not UNIX seconds on the hour")
    if any(b <= a for a, b in zip(times, times[1:])):
        return refuse("hours out of order")
    for v in HOURLY_VARS:
        col = hourly.get(v)
        if not isinstance(col, list) or len(col) != len(times) or not all(x is None or _is_number(x) for x in col):
            return refuse(f"{v} missing or malformed")
    lo = datetime.combine(start_utc.date(), datetime.min.time(), tzinfo=timezone.utc).timestamp()
    hi = datetime.combine(end_utc.date() + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc).timestamp()
    keep = [i for i, t in enumerate(times) if lo <= t < hi]
    if not keep or times[keep[0]] > start_utc.timestamp() or times[keep[-1]] < end_utc.timestamp() - 3600:
        return refuse("does not cover the whole night")
    units = body.get("hourly_units") if isinstance(body.get("hourly_units"), dict) else {}
    return Forecast(
        status="ok",
        retrieved_at_utc=retrieved,
        grid_latitude=float(body["latitude"]),
        grid_longitude=float(body["longitude"]),
        grid_elevation_m=float(body["elevation"]) if _is_number(body.get("elevation")) else None,
        times=[times[i] for i in keep],
        values={v: [hourly[v][i] for i in keep] for v in HOURLY_VARS},
        units={k: str(u) for k, u in units.items() if k in HOURLY_VARS},
    )


class OpenMeteoProvider:
    def __init__(self, fetch: Fetcher | None = None, now: Callable[[], datetime] | None = None):
        self._fetch = fetch or _default_fetch
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._cache: dict[tuple, tuple[float, Forecast]] = {}
        self._lock = threading.Lock()
        self._rate_limited: tuple[float, Forecast] | None = None
        self._relayed: OrderedDict[tuple, tuple[float, Forecast]] = OrderedDict()

    def clear_cache(self) -> None:
        with self._lock:
            self._cache.clear()
            self._rate_limited = None
            self._relayed.clear()

    @staticmethod
    def _key(lat: float, lon: float, start_utc: datetime, end_utc: datetime) -> tuple:
        return (round(lat, 2), round(lon, 2), start_utc.date().isoformat(), end_utc.date().isoformat())

    def relay(self, client: str, lat: float, lon: float, start_utc: datetime, end_utc: datetime, body: Any) -> Forecast:
        """Keep a forecast the visitor's browser fetched from Open-Meteo, for that browser only.

        Returns the Forecast that was kept, or a non-ok one saying why the answer was not usable (then nothing is
        kept and this server fetches the forecast itself as before).
        """
        retrieved = self._now().isoformat(timespec="seconds").replace("+00:00", "Z")
        fc = relayed_forecast(body, lat, lon, start_utc, end_utc, retrieved)
        if fc.ok:
            with self._lock:
                self._relayed[(client, self._key(lat, lon, start_utc, end_utc))] = (_time.monotonic() + RELAY_TTL_S, fc)
                while len(self._relayed) > RELAY_MAX_ENTRIES:
                    self._relayed.popitem(last=False)
        return fc

    def forecast(self, lat: float, lon: float, start_utc: datetime, end_utc: datetime,
                 client: str | None = None) -> Forecast:
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

        key = self._key(lat, lon, start_utc, end_utc)
        with self._lock:
            mine = self._relayed.get((client, key)) if client else None
            if mine and mine[0] > _time.monotonic():
                return mine[1]
            hit = self._cache.get(key)
            if hit and hit[0] > _time.monotonic():
                fc = hit[1]
                return Forecast(**{**fc.__dict__, "from_cache": True})
            limited = self._rate_limited
            if limited and limited[0] > _time.monotonic():
                return Forecast(**{**limited[1].__dict__, "from_cache": True})

        fc = self._request(lat, lon, start_d, end_d)
        ttl = CACHE_TTL_S if fc.ok else ERROR_CACHE_TTL_S
        with self._lock:
            self._cache[key] = (_time.monotonic() + ttl, fc)
            if fc.reason_code == "rate_limited":
                self._rate_limited = (_time.monotonic() + rate_limit_cooldown_s(fc.message), fc)
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
        return parse_response(resp.status_code, body, retrieved)

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
