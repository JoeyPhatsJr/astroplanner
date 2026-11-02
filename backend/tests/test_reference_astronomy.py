"""Astronomy checked against independent references (USNO, Meeus)."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import astropy.units as u
import numpy as np
import pytest
from astropy.coordinates import TETE, AltAz, EarthLocation, SkyCoord
from astropy.time import Time

from app.astronomy import moon_illumination, night_summary, sky_context

from .reference_data import (
    MEEUS_13B,
    TROMSO_MIDNIGHT_SUN,
    USNO_MOON_CASES,
    USNO_MOON_PHASES_UTC,
    USNO_SUN_CASES,
)

TOL_MIN = 1.5  # USNO rounds to the minute


def _local_ts(s: str, tz: str) -> float:
    return datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=ZoneInfo(tz)).timestamp()


def _iso_ts(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


@pytest.mark.parametrize("lat,lon,tz,night,expected", USNO_SUN_CASES)
def test_sun_events_match_usno(lat, lon, tz, night, expected):
    s = night_summary(sky_context(lat, lon, 0.0, date.fromisoformat(night), tz))
    for key, local in expected.items():
        got = _iso_ts(s["events"][key])
        diff_min = (got - _local_ts(local, tz)) / 60
        assert abs(diff_min) <= TOL_MIN, f"{key}: {diff_min:+.2f} min vs USNO {local} {tz}"


@pytest.mark.parametrize("lat,lon,tz,night,event,local", USNO_MOON_CASES)
def test_moon_rise_set_match_usno(lat, lon, tz, night, event, local):
    s = night_summary(sky_context(lat, lon, 0.0, date.fromisoformat(night), tz))
    times = [_iso_ts(e["time_utc"]) for e in s["moon"]["events"] if e["event"] == event]
    target = _local_ts(local, tz)
    assert times, f"no {event} found"
    assert min(abs(t - target) for t in times) / 60 <= TOL_MIN


def test_midnight_sun_tromso_has_no_darkness():
    lat, lon, tz, night, lower_transit = TROMSO_MIDNIGHT_SUN
    ctx = sky_context(lat, lon, 0.0, date.fromisoformat(night), tz)
    s = night_summary(ctx)
    assert not s["has_darkness"] and s["dark_minutes"] == 0
    assert s["events"]["sunset_utc"] is None and s["events"]["sunrise_utc"] is None
    assert any("midnight sun" in n for n in s["notes"])
    # Lowest Sun coincides with USNO's lower transit
    t_min = float(ctx.t[int(np.argmin(ctx.sun_alt))])
    assert abs(t_min - _local_ts(lower_transit, tz)) / 60 <= 5  # 5-min grid


@pytest.mark.parametrize("utc,phase", USNO_MOON_PHASES_UTC)
def test_moon_illumination_at_usno_phases(utc, phase):
    illum, waxing = moon_illumination(Time([utc], scale="utc"))
    k = float(illum[0])
    if phase == "new":
        assert k < 0.005
    elif phase == "full":
        assert k > 0.995
    else:
        assert abs(k - 0.5) < 0.01
        assert bool(waxing[0]) == (phase == "first_quarter")


def test_meeus_example_13b_venus_altaz():
    """Astropy apparent-of-date -> AltAz reproduces Meeus to better than 0.01 deg."""
    m = MEEUS_13B
    h, mi, s = m["ra_hms"]
    d, dm, ds = m["dec_dms"]
    ra = (h + mi / 60 + s / 3600) * 15
    dec = -(abs(d) + dm / 60 + ds / 3600)
    t = Time(m["utc"], scale="utc")
    loc = EarthLocation.from_geodetic(lon=m["lon"] * u.deg, lat=m["lat"] * u.deg, height=0 * u.m)
    venus = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame=TETE(obstime=t))
    aa = venus.transform_to(AltAz(obstime=t, location=loc, pressure=0 * u.hPa))
    az_from_south = (aa.az.deg - 180.0) % 360.0
    assert abs(aa.alt.deg - m["alt_deg"]) < 0.01
    assert abs(az_from_south - m["az_deg_from_south_westward"]) < 0.01


def test_polaris_altitude_tracks_latitude():
    """Polaris (dec ~ +89.26) stays within ~0.8 deg of the observer's latitude all night."""
    from app import catalog  # noqa: F401  (ensures catalog loads)

    lat = 40.0
    t = Time(datetime(2026, 11, 2, 3, 0).isoformat(), scale="utc") + np.arange(0, 12) * u.hour
    loc = EarthLocation.from_geodetic(lon=-75 * u.deg, lat=lat * u.deg)
    polaris = SkyCoord(ra=37.95456 * u.deg, dec=89.264109 * u.deg)
    alt = polaris.transform_to(AltAz(obstime=t, location=loc, pressure=0 * u.hPa)).alt.deg
    assert np.all(np.abs(alt - lat) < 0.8)
