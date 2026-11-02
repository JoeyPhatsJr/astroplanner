"""Location helpers: Open-Meteo place search and offline timezone lookup."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

import httpx

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
USER_AGENT = "AstroPlanner/0.1 (local non-commercial prototype)"


class GeocodeError(Exception):
    pass


def search_places(query: str, count: int = 8) -> list[dict[str, Any]]:
    try:
        with httpx.Client(timeout=8.0, headers={"User-Agent": USER_AGENT}) as client:
            r = client.get(GEOCODE_URL, params={"name": query, "count": count, "language": "en", "format": "json"})
    except httpx.HTTPError as exc:
        raise GeocodeError(f"Could not reach the Open-Meteo geocoding service ({type(exc).__name__}).") from exc
    if r.status_code != 200:
        raise GeocodeError(f"Geocoding service returned HTTP {r.status_code}.")
    out = []
    for p in r.json().get("results") or []:
        label = ", ".join(x for x in [p.get("name"), p.get("admin1"), p.get("country")] if x)
        elev = p.get("elevation")
        if not isinstance(elev, (int, float)) or not (-500 <= elev <= 9000):
            elev = None  # Open-Meteo uses -9999 as a missing-elevation sentinel
        out.append({
            "label": label,
            "latitude": p.get("latitude"),
            "longitude": p.get("longitude"),
            "elevation_m": elev,
            "timezone": p.get("timezone"),
            "country_code": p.get("country_code"),
            "population": p.get("population"),
        })
    return out


@lru_cache(maxsize=1)
def _finder():
    from timezonefinder import TimezoneFinder

    return TimezoneFinder()


def timezone_at(lat: float, lon: float) -> str | None:
    """IANA timezone for coordinates using offline timezone-boundary data."""
    return _finder().timezone_at(lng=lon, lat=lat)
