"""Score components, bounds, normalization and missing-weather behaviour."""

from __future__ import annotations

from datetime import date

import numpy as np
import pytest

from app import catalog
from app.astronomy import sky_context
from app.scoring import (
    TONIGHT_WEIGHTS,
    airmass,
    altitude_points,
    best_window,
    cloud_points,
    darkness_points,
    duration_points,
    moon_interference,
    moon_sky_points,
    precip_points,
    target_moon_points,
    target_score,
    tonight_score,
    weather_points,
)
from app.visibility import analyse_target

from .reference_data import PHILADELPHIA, TROMSO

NY = "America/New_York"


@pytest.fixture(scope="module")
def ctx():
    return sky_context(*PHILADELPHIA, 0.0, date(2026, 11, 2), NY)


def flat_weather(ctx, cloud=0.0, precip=0.0):
    n = len(ctx.t)
    return {"cloud_cover": np.full(n, cloud, dtype=float), "precipitation_probability": np.full(n, precip, dtype=float)}


# ---- component functions ---------------------------------------------------------

def test_component_bounds():
    assert cloud_points(0) == 45 and cloud_points(100) == 0 and cloud_points(150) == 0 and cloud_points(-5) == 45
    assert precip_points(0) == 25 and precip_points(100) == 0
    assert moon_sky_points(1.0, -10.0) == 20  # full Moon below horizon costs nothing
    assert moon_sky_points(1.0, 30.0) == 0
    assert moon_sky_points(0.25, 30.0) == pytest.approx(15)
    assert darkness_points(0) == 0 and darkness_points(360) == 10 and darkness_points(900) == 10
    assert sum(TONIGHT_WEIGHTS.values()) == 100


def test_airmass_and_altitude_points_monotonic():
    alts = np.array([24, 30, 45, 60, 90])
    pts = [altitude_points(float(x)) for x in airmass(alts)]
    assert pts == sorted(pts)
    assert altitude_points(1.0) == 30 and altitude_points(2.0) == pytest.approx(10) and altitude_points(3.0) == 0


def test_duration_and_weather_points_bounds():
    assert duration_points(0) == 0 and duration_points(240) == 25 and duration_points(600) == 25
    assert weather_points(np.array([0.0]), np.array([0.0])) == 25
    assert weather_points(np.array([100.0]), np.array([100.0])) == 0


def test_moon_interference_rules():
    assert moon_interference(np.array([1.0]), np.array([-5.0]), np.array([5.0]))[0] == 0  # Moon down
    assert moon_interference(np.array([1.0]), np.array([20.0]), np.array([10.0]))[0] == 1
    assert moon_interference(np.array([1.0]), np.array([20.0]), np.array([170.0]))[0] == pytest.approx(0.2)
    assert target_moon_points(1.0, emission=True) == pytest.approx(10)
    assert target_moon_points(1.0, emission=False) == 0


def test_best_window_prefers_highest_full_width_window():
    scores = np.array([1, 1, 1, 9, 9, 9, 1, 50, 1], dtype=float)
    eligible = np.array([1, 1, 1, 1, 1, 1, 1, 0, 1], dtype=bool)
    assert best_window(scores, eligible, 3) == (3, 5)
    # the 50 is ineligible and a 1-sample run cannot beat full-width windows
    assert best_window(scores, np.ones(9, bool), 3) == (5, 7)


# ---- Tonight's Score -------------------------------------------------------------

def _sum(components):
    return round(sum(c["points"] for c in components if c["points"] is not None), 1)


def test_tonight_total_equals_component_sum_and_is_bounded(ctx):
    for cloud, precip in [(0, 0), (50, 20), (100, 100)]:
        s = tonight_score(ctx, flat_weather(ctx, cloud, precip))
        assert s["status"] == "ok"
        assert s["total"] == pytest.approx(_sum(s["components"]), abs=0.051)
        assert 0 <= s["total"] <= 100
        for c in s["components"]:
            assert 0 <= c["points"] <= c["max"]


def test_tonight_score_orders_weather_sensibly(ctx):
    clear = tonight_score(ctx, flat_weather(ctx, 0, 0))["total"]
    cloudy = tonight_score(ctx, flat_weather(ctx, 100, 90))["total"]
    assert clear - cloudy >= 60


def test_no_weather_never_produces_a_total(ctx):
    s = tonight_score(ctx, None)
    assert s["status"] == "no_weather" and s["total"] is None
    by_key = {c["key"]: c for c in s["components"]}
    assert by_key["cloud"]["points"] is None and by_key["precipitation"]["points"] is None
    assert by_key["moon"]["points"] is not None and s["partial_max"] == 30


def test_all_nan_weather_is_treated_as_missing_not_clear(ctx):
    w = flat_weather(ctx, np.nan, np.nan)
    s = tonight_score(ctx, w)
    assert s["total"] is None and s["status"] == "no_weather"


def test_partial_weather_excludes_missing_hours(ctx):
    w = flat_weather(ctx, 0, 0)
    dark = np.nonzero(ctx.sun_alt < -18)[0]
    w["precipitation_probability"][dark[: len(dark) // 2]] = np.nan
    s = tonight_score(ctx, w)
    assert s["status"] == "partial_weather" and s["total"] is not None


def test_no_darkness_gives_no_total():
    ctx = sky_context(*TROMSO, 0.0, date(2026, 6, 21), "Europe/Oslo")
    s = tonight_score(ctx, flat_weather(ctx))
    assert s["status"] == "no_darkness" and s["total"] is None
    assert {c["key"]: c["points"] for c in s["components"]}["darkness"] == 0


def test_best_window_is_two_hours_inside_darkness(ctx):
    s = tonight_score(ctx, flat_weather(ctx))
    assert s["window"]["minutes"] == 120


# ---- Target score -----------------------------------------------------------------

def _target(ctx, tid):
    t = catalog.get_target(tid)
    return t, analyse_target(ctx, catalog.target_index(tid), t["dec_deg"])


def test_target_score_sums_and_bounds(ctx):
    eq = {"fov_deg": 2.46, "fov_definition": "unknown"}
    for tid in ["m31", "m42", "ngc7000", "m13"]:
        t, v = _target(ctx, tid)
        s = target_score(ctx, v, t, flat_weather(ctx, 20, 10), eq, 30.0)
        if v.status != "observable":
            continue
        assert s["max_total"] == 100
        assert s["total"] == pytest.approx(_sum(s["components"]), abs=0.051)
        assert 0 <= s["total"] <= 100 and 2 <= len(s["why"]) <= 4


def test_target_score_without_weather_is_out_of_75(ctx):
    t, v = _target(ctx, "m31")
    s = target_score(ctx, v, t, None, None, 30.0)
    assert s["max_total"] == 75 and s["total"] <= 75
    assert any("No forecast" in c for c in s["cautions"])
    assert s["normalized"] == pytest.approx(s["total"] / 75 * 100, abs=0.06)


def test_unobservable_targets_get_no_score(ctx):
    t, v = _target(ctx, "ngc104")
    s = target_score(ctx, v, t, flat_weather(ctx), None, 30.0)
    assert s["total"] is None and s["components"] == []


def test_fov_notes_are_advisory_and_flag_unverified_axis(ctx):
    eq = {"fov_deg": 2.46, "fov_definition": "unknown"}
    t, v = _target(ctx, "ngc6960")  # Western Veil, 210'
    s = target_score(ctx, v, t, flat_weather(ctx), eq, 30.0)
    assert any("exceeds" in c and "unverified" in c for c in s["cautions"])
    s2 = target_score(ctx, v, t, flat_weather(ctx), None, 30.0)
    assert s["total"] == s2["total"]  # framing never changes the score
