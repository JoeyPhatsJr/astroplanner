"""Sun, Moon and target positions for an observer over one local night.

Conventions (documented in docs/ASTRONOMY.md):
* A "night date" D means local noon on D through local noon on D+1 in the
  observer's IANA timezone. The span is built with zoneinfo and converted to
  UTC, so DST nights are naturally 23 h or 25 h long.
* All computation is in UTC on a 5-minute grid; crossings are refined by linear
  interpolation between samples.
* Altitudes are geometric (no atmospheric refraction, pressure=0) and
  topocentric. Rise/set use the standard -0.833 deg altitude of the centre
  (34' refraction + ~16' semi-diameter), the same convention as USNO.
* Twilights use the Sun's geometric centre altitude: civil -6, nautical -12,
  astronomical -18 deg.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo

import astropy.units as u
import numpy as np
from astropy.coordinates import AltAz, EarthLocation, GeocentricTrueEcliptic, SkyCoord, get_body
from astropy.time import Time
from astropy.utils import iers

from . import catalog
from .intervals import Condition, crossings, first_crossing, intervals, total_seconds

# Use the IERS tables bundled with astropy-iers-data; never download at request
# time. Outside the table range astropy falls back to degraded (still
# arcsecond-level for our purposes) Earth-orientation values with a warning.
iers.conf.auto_download = False
iers.conf.iers_degraded_accuracy = "warn"

STEP_SECONDS = 300
RISE_SET_ALT_DEG = -0.833
TWILIGHT_DEG = {"civil": -6.0, "nautical": -12.0, "astronomical": -18.0}
DARKNESS_THRESHOLDS = {"astronomical": -18.0, "nautical": -12.0}


def tz_or_raise(tz_name: str) -> ZoneInfo:
    return ZoneInfo(tz_name)  # raises ZoneInfoNotFoundError on invalid names


def night_bounds_utc(night_date: date, tz_name: str) -> tuple[datetime, datetime]:
    tz = tz_or_raise(tz_name)
    start = datetime.combine(night_date, time(12, 0), tzinfo=tz)
    end = datetime.combine(night_date + timedelta(days=1), time(12, 0), tzinfo=tz)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def build_grid(night_date: date, tz_name: str) -> np.ndarray:
    start, end = night_bounds_utc(night_date, tz_name)
    s, e = start.timestamp(), end.timestamp()
    n = int(round((e - s) / STEP_SECONDS))
    return s + STEP_SECONDS * np.arange(n + 1, dtype=float)


def iso_utc(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(round(ts), tz=timezone.utc).isoformat().replace("+00:00", "Z")


def local_hhmm(ts: float, tz_name: str) -> str:
    return datetime.fromtimestamp(ts, tz=ZoneInfo(tz_name)).strftime("%H:%M")


def moon_illumination(times: Time) -> tuple[np.ndarray, np.ndarray]:
    """Illuminated fraction (0-1) and waxing flag from geocentric Sun/Moon geometry.

    Phase angle i follows Meeus (Astronomical Algorithms, ch. 48):
    tan i = R sin(psi) / (Delta - R cos(psi)), k = (1 + cos i) / 2.
    """
    sun = get_body("sun", times)
    moon = get_body("moon", times)
    psi = sun.separation(moon).to_value(u.rad)
    r_sun = sun.distance.to_value(u.km)
    r_moon = moon.distance.to_value(u.km)
    phase_angle = np.arctan2(r_sun * np.sin(psi), r_moon - r_sun * np.cos(psi))
    illum = (1.0 + np.cos(phase_angle)) / 2.0
    ecl = GeocentricTrueEcliptic(obstime=times)
    dlon = (moon.transform_to(ecl).lon - sun.transform_to(ecl).lon).wrap_at(360 * u.deg).deg
    return np.asarray(illum, dtype=float), np.asarray(dlon < 180.0)


def phase_name(illum: float, waxing: bool) -> str:
    if illum < 0.02:
        return "New Moon"
    if illum > 0.98:
        return "Full Moon"
    if abs(illum - 0.5) < 0.04:
        return "First Quarter" if waxing else "Last Quarter"
    if illum < 0.5:
        return "Waxing Crescent" if waxing else "Waning Crescent"
    return "Waxing Gibbous" if waxing else "Waning Gibbous"


@dataclass
class SkyContext:
    """Everything position-related for one observer and night; weather-free."""

    latitude: float
    longitude: float
    elevation_m: float
    night_date: date
    timezone: str
    t: np.ndarray  # UNIX seconds, shape (T,)
    sun_alt: np.ndarray
    moon_alt: np.ndarray
    moon_az: np.ndarray
    moon_illum: np.ndarray
    moon_waxing: np.ndarray
    target_alt: np.ndarray  # shape (N, T), catalog order
    target_az: np.ndarray

    def moon_separation(self, idx: int) -> np.ndarray:
        """Topocentric angular separation (deg) between target ``idx`` and the Moon."""
        a1, z1 = np.radians(self.target_alt[idx]), np.radians(self.target_az[idx])
        a2, z2 = np.radians(self.moon_alt), np.radians(self.moon_az)
        cos_sep = np.sin(a1) * np.sin(a2) + np.cos(a1) * np.cos(a2) * np.cos(z1 - z2)
        return np.degrees(np.arccos(np.clip(cos_sep, -1.0, 1.0)))


def _altaz_frame(times: Time, loc: EarthLocation) -> AltAz:
    return AltAz(obstime=times, location=loc, pressure=0 * u.hPa)


@lru_cache(maxsize=48)
def sky_context(
    latitude: float,
    longitude: float,
    elevation_m: float,
    night_date: date,
    tz_name: str,
    coords: tuple[tuple[float, ...], tuple[float, ...]] | None = None,
) -> SkyContext:
    """Sun/Moon/target positions for one night.

    ``coords`` is ``(ra_deg_tuple, dec_deg_tuple)`` (tuples keep the call hashable for the cache);
    ``None`` means the bundled DSO catalog, in catalog order.
    """
    t = build_grid(night_date, tz_name)
    times = Time(t, format="unix", scale="utc")
    loc = EarthLocation.from_geodetic(lon=longitude * u.deg, lat=latitude * u.deg, height=elevation_m * u.m)
    frame = _altaz_frame(times, loc)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=UserWarning)  # degraded-IERS notices far from today
        sun_altaz = get_body("sun", times).transform_to(frame)
        moon_altaz = get_body("moon", times, location=loc).transform_to(frame)
        illum, waxing = moon_illumination(times)
        if coords is None:
            ra, dec = catalog.coordinate_arrays()
        else:
            ra, dec = np.asarray(coords[0], dtype=float), np.asarray(coords[1], dtype=float)
        targets = SkyCoord(ra=ra[:, None] * u.deg, dec=dec[:, None] * u.deg, frame="icrs")
        t_altaz = targets.transform_to(frame)
    return SkyContext(
        latitude=latitude,
        longitude=longitude,
        elevation_m=elevation_m,
        night_date=night_date,
        timezone=tz_name,
        t=t,
        sun_alt=sun_altaz.alt.deg,
        moon_alt=moon_altaz.alt.deg,
        moon_az=moon_altaz.az.deg,
        moon_illum=illum,
        moon_waxing=waxing,
        target_alt=t_altaz.alt.deg,
        target_az=t_altaz.az.deg,
    )


def darkness_intervals(ctx: SkyContext, darkness: str = "astronomical") -> list[tuple[float, float]]:
    thr = DARKNESS_THRESHOLDS[darkness]
    return intervals(ctx.t, [Condition(ctx.sun_alt, thr, below=True)])


def dark_mask(ctx: SkyContext, darkness: str = "astronomical") -> np.ndarray:
    return ctx.sun_alt < DARKNESS_THRESHOLDS[darkness]


def night_summary(ctx: SkyContext, darkness: str = "astronomical") -> dict:
    t, sun = ctx.t, ctx.sun_alt
    tz = ctx.timezone
    events = {
        "sunset_utc": first_crossing(t, sun, RISE_SET_ALT_DEG, rising=False),
        "civil_dusk_utc": first_crossing(t, sun, TWILIGHT_DEG["civil"], rising=False),
        "nautical_dusk_utc": first_crossing(t, sun, TWILIGHT_DEG["nautical"], rising=False),
        "astronomical_dusk_utc": first_crossing(t, sun, TWILIGHT_DEG["astronomical"], rising=False),
        "astronomical_dawn_utc": first_crossing(t, sun, TWILIGHT_DEG["astronomical"], rising=True),
        "nautical_dawn_utc": first_crossing(t, sun, TWILIGHT_DEG["nautical"], rising=True),
        "civil_dawn_utc": first_crossing(t, sun, TWILIGHT_DEG["civil"], rising=True),
        "sunrise_utc": first_crossing(t, sun, RISE_SET_ALT_DEG, rising=True),
    }
    dark = darkness_intervals(ctx, darkness)
    thr = DARKNESS_THRESHOLDS[darkness]
    i_min = int(np.argmin(sun))
    sun_min = float(sun[i_min])

    notes: list[str] = []
    if not dark:
        if sun_min > RISE_SET_ALT_DEG:
            notes.append("The Sun does not set on this night (midnight sun).")
        notes.append(
            f"The Sun stays above {thr:.0f}° all night (lowest {sun_min:.1f}° at "
            f"{local_hhmm(float(t[i_min]), tz)}), so there is no {darkness} darkness."
        )
        if darkness == "astronomical" and sun_min < DARKNESS_THRESHOLDS["nautical"]:
            notes.append("Nautical darkness (Sun below −12°) does occur; you can switch the darkness setting.")
    if float(sun.max()) < RISE_SET_ALT_DEG:
        notes.append("The Sun does not rise during this span (polar night).")

    moon_events = []
    for c in crossings(t, ctx.moon_alt, RISE_SET_ALT_DEG):
        moon_events.append({"event": "moonrise" if c.rising else "moonset", "time_utc": iso_utc(c.t)})

    # Moon summary over darkness (or over the whole span if no darkness).
    mask = dark_mask(ctx, darkness)
    sel = mask if mask.any() else np.ones_like(mask)
    moon_up = ctx.moon_alt > RISE_SET_ALT_DEG
    mid = int(np.nonzero(sel)[0][len(np.nonzero(sel)[0]) // 2])
    illum_mid = float(ctx.moon_illum[mid])
    waxing_mid = bool(ctx.moon_waxing[mid])

    sunset = events["sunset_utc"]
    sunrise = events["sunrise_utc"]
    disp_start = (sunset - 2700) if sunset else float(t[0])
    disp_end = (sunrise + 2700) if sunrise else float(t[-1])

    return {
        "night_date": ctx.night_date.isoformat(),
        "timezone": tz,
        "span_start_utc": iso_utc(float(t[0])),
        "span_end_utc": iso_utc(float(t[-1])),
        "span_hours": round((float(t[-1]) - float(t[0])) / 3600, 3),
        "display_start_utc": iso_utc(max(disp_start, float(t[0]))),
        "display_end_utc": iso_utc(min(disp_end, float(t[-1]))),
        "events": {k: iso_utc(v) for k, v in events.items()},
        "darkness": darkness,
        "darkness_threshold_deg": thr,
        "dark_intervals": [{"start_utc": iso_utc(s), "end_utc": iso_utc(e)} for s, e in dark],
        "dark_minutes": round(total_seconds(dark) / 60, 1),
        "has_darkness": bool(dark),
        "sun_min_alt_deg": round(sun_min, 2),
        "notes": notes,
        "moon": {
            "illumination": round(illum_mid, 4),
            "phase_name": phase_name(illum_mid, waxing_mid),
            "waxing": waxing_mid,
            "up_fraction_of_dark": round(float(moon_up[sel].mean()), 3),
            "max_alt_dark_deg": round(float(ctx.moon_alt[sel].max()), 2),
            "events": moon_events,
            "reference_time_utc": iso_utc(float(t[mid])),
        },
        "method": {
            "step_minutes": STEP_SECONDS // 60,
            "altitudes": "geometric (no refraction), topocentric, Astropy AltAz",
            "rise_set_altitude_deg": RISE_SET_ALT_DEG,
            "twilight_definition": "Sun centre altitude: civil −6°, nautical −12°, astronomical −18°",
            "moon_illumination": "Meeus phase-angle formula from Astropy geocentric Sun/Moon positions",
        },
        "series": {
            "t_ms": (ctx.t * 1000).astype(np.int64).tolist(),
            "sun_alt_deg": np.round(ctx.sun_alt, 2).tolist(),
            "moon_alt_deg": np.round(ctx.moon_alt, 2).tolist(),
            "moon_illumination": np.round(ctx.moon_illum, 4).tolist(),
        },
    }
