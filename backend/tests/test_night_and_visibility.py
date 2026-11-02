"""Night boundaries, DST, seasonal edge cases and per-target visibility rules."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import numpy as np
import pytest

from app import catalog
from app.astronomy import DARKNESS_THRESHOLDS, build_grid, night_bounds_utc, night_summary, sky_context
from app.intervals import Condition, crossings, intervals
from app.visibility import analyse_target, theoretical_altitude_range

from .reference_data import PHILADELPHIA, TROMSO

NY = "America/New_York"


def _ctx(lat, lon, d, tz):
    return sky_context(lat, lon, 0.0, date.fromisoformat(d), tz)


def _vis(ctx, tid, min_alt=30.0, darkness="astronomical"):
    t = catalog.get_target(tid)
    return analyse_target(ctx, catalog.target_index(tid), t["dec_deg"], min_alt, darkness)


# ---- night span & DST ---------------------------------------------------------

@pytest.mark.parametrize("night,hours", [("2026-03-07", 23), ("2026-10-31", 25), ("2026-11-02", 24)])
def test_night_span_follows_local_dst(night, hours):
    start, end = night_bounds_utc(date.fromisoformat(night), NY)
    assert (end - start).total_seconds() / 3600 == hours
    assert start.astimezone(ZoneInfo(NY)).hour == 12 and end.astimezone(ZoneInfo(NY)).hour == 12


def test_night_date_means_evening_of_that_date():
    s = night_summary(_ctx(*PHILADELPHIA, "2026-11-02", NY))
    dusk = datetime.fromisoformat(s["events"]["astronomical_dusk_utc"].replace("Z", "+00:00")).astimezone(ZoneInfo(NY))
    dawn = datetime.fromisoformat(s["events"]["astronomical_dawn_utc"].replace("Z", "+00:00")).astimezone(ZoneInfo(NY))
    assert dusk.date() == date(2026, 11, 2) and dusk.hour >= 17
    assert dawn.date() == date(2026, 11, 3) and dawn.hour < 7
    # UTC date of dusk differs from local date only via conversion, never by mislabeling
    assert s["night_date"] == "2026-11-02"


def test_grid_is_uniform_utc():
    t = build_grid(date(2026, 3, 7), NY)
    assert np.all(np.diff(t) == 300)


def test_seasonal_darkness_longer_in_winter():
    winter = night_summary(_ctx(*PHILADELPHIA, "2026-12-21", NY))["dark_minutes"]
    summer = night_summary(_ctx(*PHILADELPHIA, "2026-06-21", NY))["dark_minutes"]
    assert winter > summer + 180  # several hours more astronomical darkness
    assert 13 * 60 > winter > 9 * 60 and 7 * 60 > summer > 3 * 60


def test_no_astronomical_but_nautical_darkness_at_high_latitude():
    # London-ish latitude near the summer solstice: Sun never reaches -18 deg but does pass -12 deg
    ctx = sky_context(51.5, -0.12, 0.0, date(2026, 6, 21), "Europe/London")
    astro = night_summary(ctx, "astronomical")
    naut = night_summary(ctx, "nautical")
    assert not astro["has_darkness"]
    assert any("Nautical darkness" in n for n in astro["notes"])
    assert naut["has_darkness"] and naut["dark_minutes"] > 0


def test_polar_night_note():
    ctx = sky_context(*TROMSO, 0.0, date(2026, 12, 21), "Europe/Oslo")
    s = night_summary(ctx)
    assert any("polar night" in n for n in s["notes"])
    assert s["events"]["sunrise_utc"] is None


# ---- intervals helper -----------------------------------------------------------

def test_crossing_interpolation_is_exact_for_linear_series():
    t = np.arange(0, 3600 * 4 + 1, 300, dtype=float)
    y = (t - 5000.0) / 100.0  # crosses 0 at t=5000 s
    c = crossings(t, y, 0.0)
    assert len(c) == 1 and c[0].rising and abs(c[0].t - 5000.0) < 1e-6


def test_intervals_combine_conditions_and_clip_to_span():
    t = np.arange(0, 1000, 10, dtype=float)
    a = t - 200.0  # >= 0 from t=200
    b = 700.0 - t  # >= 0 until t=700
    spans = intervals(t, [Condition(a, 0.0, below=False), Condition(b, 0.0, below=False)])
    assert len(spans) == 1
    assert abs(spans[0][0] - 200) < 1e-6 and abs(spans[0][1] - 700) < 1e-6


# ---- visibility rules ------------------------------------------------------------

def test_never_rising_target():
    v = _vis(_ctx(*PHILADELPHIA, "2026-11-02", NY), "ngc104")  # 47 Tuc, dec -72
    assert v.status == "never_rises" and v.never_rises and v.best_window is None


def test_target_below_threshold_from_latitude():
    v = _vis(_ctx(*PHILADELPHIA, "2026-11-02", NY), "ngc5139")  # Omega Cen peaks ~2 deg
    assert v.status == "below_threshold" and v.culmination_alt_deg < 30


def test_circumpolar_target():
    v = _vis(sky_context(50.0, 10.0, 0.0, date(2026, 11, 2), "Europe/Berlin"), "m81")
    assert v.circumpolar
    assert theoretical_altitude_range(69.07, 50.0)[0] > 0


def test_target_up_only_in_daylight_is_not_observable():
    # Mid-June: the Sun sits near RA 6h, so M1 (RA 5h35m) culminates around local noon
    ctx = _ctx(*PHILADELPHIA, "2026-06-21", NY)
    v = _vis(ctx, "m1")
    assert v.culmination_alt_deg > 30  # it IS high, but in daylight
    assert v.status == "daylight_only"
    assert v.best_window is None


def test_windows_only_contain_darkness_above_min_altitude():
    ctx = _ctx(*PHILADELPHIA, "2026-11-02", NY)
    thr = DARKNESS_THRESHOLDS["astronomical"]
    for t in catalog.all_targets():
        v = _vis(ctx, t["id"])
        for s, e in v.windows:
            inside = (ctx.t > s + 1) & (ctx.t < e - 1)
            assert np.all(ctx.sun_alt[inside] < thr)
            assert np.all(ctx.target_alt[v.index][inside] >= 30.0)


def test_raising_min_altitude_never_adds_observable_targets():
    ctx = _ctx(*PHILADELPHIA, "2026-11-02", NY)
    low = {t["id"] for t in catalog.all_targets() if _vis(ctx, t["id"], 30).status == "observable"}
    high = {t["id"] for t in catalog.all_targets() if _vis(ctx, t["id"], 60).status == "observable"}
    assert high <= low and len(high) < len(low)
    for tid in high:
        assert _vis(ctx, tid, 60).max_alt_dark_deg >= 60


def test_altitude_changes_smoothly_through_the_night():
    ctx = _ctx(*PHILADELPHIA, "2026-11-02", NY)
    alt = ctx.target_alt[catalog.target_index("m42")]
    # Max change per 5 min is bounded by Earth's rotation (15 deg/h -> 1.25 deg per 5 min)
    assert np.max(np.abs(np.diff(alt))) <= 1.26
    assert alt.max() - alt.min() > 50  # it really rises and sets


def test_moon_separation_is_computed_topocentrically():
    ctx = _ctx(*PHILADELPHIA, "2026-11-02", NY)
    sep = ctx.moon_separation(catalog.target_index("m42"))
    assert np.all((sep >= 0) & (sep <= 180))
    assert np.ptp(sep) > 0.1  # changes during the night (Moon moves ~0.5 deg/h)
