"""Visibility endpoint for curated variable stars (explicit-coordinate sky context)."""

from __future__ import annotations

from datetime import date

import astropy.units as u
import numpy as np
from astropy.coordinates import AltAz, EarthLocation, SkyCoord
from astropy.time import Time

from app import astronomy
from app.variables import catalog as vcat

from .conftest import PHILLY_PARAMS

LAT, LON, TZ = 39.9526, -75.1652, "America/New_York"


def test_variable_altitude_matches_independent_astropy(client):
    star = vcat.star_by_slug("t-crb")
    params = {**PHILLY_PARAMS, "date": "2027-03-15"}
    j = client.get("/api/variables/t-crb/visibility", params=params).json()
    series = j["visibility"]["series"]
    ts_key = next(k for k in series if k.endswith("_ms") or k in ("t_ms", "times_ms"))
    alts = np.array(series["alt_deg"], dtype=float)
    times = Time(np.array(series[ts_key], dtype=float) / 1000.0, format="unix", scale="utc")
    loc = EarthLocation.from_geodetic(lon=params["lon"] * u.deg, lat=params["lat"] * u.deg, height=0 * u.m)
    expected = SkyCoord(ra=star["ra_deg"] * u.deg, dec=star["dec_deg"] * u.deg, frame="icrs").transform_to(
        AltAz(obstime=times, location=loc, pressure=0 * u.hPa)
    ).alt.deg
    assert len(alts) > 200
    assert np.max(np.abs(alts - expected)) < 0.1
    assert j["star"]["id"] == "var:t-crb" and "score" not in j
    assert len(series["sun_alt_deg"]) == len(alts) and len(series["moon_alt_deg"]) == len(alts)
    assert {"events", "dark_intervals", "has_darkness", "notes", "moon", "timezone", "night_date"} <= set(j["night"])


def test_unknown_slug_404(client):
    assert client.get("/api/variables/nope/visibility", params=PHILLY_PARAMS).status_code == 404


def test_catalog_sky_context_unchanged():
    ctx = astronomy.sky_context(LAT, LON, 0.0, date(2026, 11, 2), TZ, None)
    assert ctx.target_alt.shape[0] == 58
    default = astronomy.sky_context(LAT, LON, 0.0, date(2026, 11, 2), TZ)
    assert np.array_equal(ctx.target_alt, default.target_alt) and np.array_equal(ctx.target_az, default.target_az)


def test_explicit_coords_single_row():
    ctx = astronomy.sky_context(LAT, LON, 0.0, date(2026, 11, 2), TZ, coords=((233.8,), (25.9,)))
    assert ctx.target_alt.shape[0] == 1 and ctx.target_az.shape[0] == 1


def test_low_in_november(client):
    params = {**PHILLY_PARAMS, "date": "2026-11-15", "min_altitude_deg": 30}
    v = client.get("/api/variables/t-crb/visibility", params=params).json()["visibility"]
    assert v["status"] != "observable" and not v["can_observe"]
    assert v["windows"] == [] or v["status"] == "too_brief"
    assert v["status_text"] and v["status_detail"]
