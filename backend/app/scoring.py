"""Transparent, heuristic planning scores (see docs/SCORING.md).

Both scores are planning estimates built from documented rules. They are NOT
measurements of sky quality, transparency or seeing. Every component returns
its points, its maximum, the data it was based on, and a human explanation.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from .astronomy import DARKNESS_THRESHOLDS, RISE_SET_ALT_DEG, SkyContext, iso_utc, local_hhmm
from .visibility import TargetVisibility

# ---- Tonight's Score -------------------------------------------------------
TONIGHT_WEIGHTS = {"cloud": 45.0, "precipitation": 25.0, "moon": 20.0, "darkness": 10.0}
TONIGHT_WINDOW_SAMPLES = 24  # 24 x 5 min = 2 h best contiguous window
FULL_DARKNESS_MINUTES = 360.0  # 6 h of darkness earns the full darkness component

# ---- Target recommendation score ------------------------------------------
TARGET_WEIGHTS = {"altitude": 30.0, "duration": 25.0, "moon": 20.0, "weather": 25.0}
FULL_DURATION_MINUTES = 240.0
EMISSION_MOON_SENSITIVITY = 0.5  # heuristic: emission-line targets tolerate moonlight better
FAVORABLE_CLOUD_PCT = 40.0
FAVORABLE_PRECIP_PCT = 30.0


def clamp01(x):
    return np.clip(x, 0.0, 1.0)


def cloud_points(cloud_pct) -> np.ndarray:
    return TONIGHT_WEIGHTS["cloud"] * (1.0 - clamp01(np.asarray(cloud_pct, float) / 100.0))


def precip_points(precip_prob_pct) -> np.ndarray:
    return TONIGHT_WEIGHTS["precipitation"] * (1.0 - clamp01(np.asarray(precip_prob_pct, float) / 100.0))


def moon_sky_points(illum, moon_alt) -> np.ndarray:
    """20 points when the Moon is below the horizon, otherwise 20 × unlit fraction."""
    illum = clamp01(np.asarray(illum, float))
    up = np.asarray(moon_alt, float) > RISE_SET_ALT_DEG
    return TONIGHT_WEIGHTS["moon"] * np.where(up, 1.0 - illum, 1.0)


def darkness_points(dark_minutes: float) -> float:
    return float(TONIGHT_WEIGHTS["darkness"] * clamp01(dark_minutes / FULL_DARKNESS_MINUTES))


def runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Inclusive (start, end) index runs where mask is True."""
    padded = np.concatenate([[False], np.asarray(mask, bool), [False]]).astype(np.int8)
    d = np.diff(padded)
    return [(int(s), int(e)) for s, e in zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0] - 1)]


def best_window(sample_scores: np.ndarray, eligible: np.ndarray, width: int) -> tuple[int, int] | None:
    """(start, end inclusive) indices of the highest-mean window of ``width`` eligible samples.

    A run of eligible samples shorter than ``width`` is used whole, but full-width
    windows are always preferred over such fallbacks. Ties resolve to the earliest.
    """
    best: tuple[bool, float, int, int] | None = None
    for s, e in runs(eligible):
        w = min(width, e - s + 1)
        means = np.convolve(sample_scores[s : e + 1], np.ones(w) / w, mode="valid")
        k = int(np.argmax(means))
        cand = (w == width, float(means[k]), s + k, s + k + w - 1)
        if best is None or cand[:2] > best[:2]:
            best = cand
    return None if best is None else (best[2], best[3])


def _r(x):
    return None if x is None else round(float(x), 1)


def _window(ctx: SkyContext, s: int, e: int) -> dict[str, Any]:
    step = float(ctx.t[1] - ctx.t[0])
    return {
        "start_utc": iso_utc(float(ctx.t[s])),
        "end_utc": iso_utc(float(ctx.t[e]) + step),
        "minutes": round((e - s + 1) * step / 60, 1),
    }


def _moon_detail(ctx: SkyContext, s: int, e: int) -> str:
    up = ctx.moon_alt[s : e + 1] > RISE_SET_ALT_DEG
    illum = float(ctx.moon_illum[s : e + 1].mean())
    if not up.any():
        return f"Moon below the horizon throughout the window ({illum * 100:.0f}% illuminated)"
    return f"Moon up {up.mean() * 100:.0f}% of the window, {illum * 100:.0f}% illuminated"


TONIGHT_METHOD = (
    "Per 5-minute sample during darkness: cloud 45×(1−cloud%/100), rain 25×(1−precipitation "
    "probability/100), Moon 20×(1−illuminated fraction) while the Moon is up (20 when it is down). "
    "The best contiguous 2-hour window of darkness is averaged, then darkness adds "
    "10×min(dark minutes/360, 1). Hourly forecast values are applied to the nearest hour."
)


def tonight_score(ctx: SkyContext, weather: dict[str, np.ndarray] | None, darkness: str = "astronomical") -> dict[str, Any]:
    """Tonight's Score over the best contiguous 2 h window of darkness.

    ``weather`` holds per-grid-sample arrays ``cloud_cover`` and
    ``precipitation_probability`` (NaN where missing), or is None if no forecast.
    """
    thr = DARKNESS_THRESHOLDS[darkness]
    dark = ctx.sun_alt < thr
    step_min = float(ctx.t[1] - ctx.t[0]) / 60
    dark_minutes = float(dark.sum() * step_min)
    moon_pts = moon_sky_points(ctx.moon_illum, ctx.moon_alt)
    dark_pts = round(darkness_points(dark_minutes), 1)

    base = {
        "kind": "heuristic",
        "max_total": 100,
        "darkness": darkness,
        "method": TONIGHT_METHOD,
        "disclaimer": "Planning estimate from forecasts and geometry, not a measured sky-quality, transparency or seeing index.",
    }

    def comp(key, label, points, basis, detail):
        return {"key": key, "label": label, "points": _r(points), "max": TONIGHT_WEIGHTS[key], "basis": basis, "detail": detail}

    darkness_comp = comp(
        "darkness", "Darkness available", dark_pts, "calculated",
        f"{dark_minutes / 60:.1f} h with the Sun below {thr:.0f}° (6 h earns full points)",
    )

    if not dark.any():
        msg = "Not scored: no darkness"
        return base | {
            "status": "no_darkness",
            "total": None,
            "window": None,
            "components": [
                comp("cloud", "Cloud cover", None, "forecast", msg),
                comp("precipitation", "Rain risk", None, "forecast", msg),
                comp("moon", "Moonlight", None, "calculated", msg),
                darkness_comp,
            ],
            "summary": f"No {darkness} darkness on this night, so no Tonight's Score is produced.",
        }

    cloud = weather.get("cloud_cover") if weather else None
    precip = weather.get("precipitation_probability") if weather else None
    weather_ok = (~np.isnan(cloud) & ~np.isnan(precip)) if (cloud is not None and precip is not None) else None

    if weather_ok is None or not (dark & weather_ok).any():
        s, e = best_window(moon_pts, dark, TONIGHT_WINDOW_SAMPLES)
        moon_mean = round(float(moon_pts[s : e + 1].mean()), 1)
        reason = "Forecast unavailable" if weather_ok is None else "Forecast has no usable values during darkness"
        return base | {
            "status": "no_weather",
            "total": None,
            "partial_total": round(moon_mean + dark_pts, 1),
            "partial_max": TONIGHT_WEIGHTS["moon"] + TONIGHT_WEIGHTS["darkness"],
            "window": _window(ctx, s, e),
            "components": [
                comp("cloud", "Cloud cover", None, "forecast", reason),
                comp("precipitation", "Rain risk", None, "forecast", reason),
                comp("moon", "Moonlight", moon_mean, "calculated", _moon_detail(ctx, s, e)),
                darkness_comp,
            ],
            "summary": f"{reason}: showing calculated Moon and darkness indicators only. No weather-backed total.",
        }

    cp = cloud_points(np.nan_to_num(cloud))
    pp = precip_points(np.nan_to_num(precip))
    eligible = dark & weather_ok
    s, e = best_window(cp + pp + moon_pts, eligible, TONIGHT_WINDOW_SAMPLES)
    sl = slice(s, e + 1)
    c_mean, p_mean, m_mean = (round(float(x[sl].mean()), 1) for x in (cp, pp, moon_pts))
    total = round(c_mean + p_mean + m_mean + dark_pts, 1)
    partial = bool((dark & ~weather_ok).any())
    return base | {
        "status": "partial_weather" if partial else "ok",
        "total": total,
        "window": _window(ctx, s, e),
        "components": [
            comp("cloud", "Cloud cover", c_mean, "forecast",
                 f"Mean forecast cloud cover {float(np.mean(cloud[sl])):.0f}% in the best window"),
            comp("precipitation", "Rain risk", p_mean, "forecast",
                 f"Mean precipitation probability {float(np.mean(precip[sl])):.0f}% (0% does not guarantee dry skies)"),
            comp("moon", "Moonlight", m_mean, "calculated", _moon_detail(ctx, s, e)),
            darkness_comp,
        ],
        "summary": (
            "Some darkness hours lack forecast values and were excluded from the window search."
            if partial else "Best 2-hour window of darkness using hourly forecast values."
        ),
    }


# ---- Target recommendation -------------------------------------------------

def airmass(alt_deg) -> np.ndarray:
    """Plane-parallel airmass sec(z); adequate above ~20° altitude."""
    return 1.0 / np.sin(np.radians(np.clip(np.asarray(alt_deg, float), 1.0, 90.0)))


def altitude_points(median_airmass: float) -> float:
    """30 at the zenith (X=1), 10 at 30° (X=2), 0 at X ≥ 2.5 (~23.6°)."""
    return float(TARGET_WEIGHTS["altitude"] * clamp01((2.5 - median_airmass) / 1.5))


def duration_points(window_minutes: float) -> float:
    return float(TARGET_WEIGHTS["duration"] * clamp01(window_minutes / FULL_DURATION_MINUTES))


def moon_interference(illum, moon_alt, sep_deg) -> np.ndarray:
    """Per-sample 0–1 interference: illumination × proximity while the Moon is up.

    Proximity g(sep) = clip((120 − sep)/100, 0.2, 1): 1 within 20°, a 0.2 floor
    beyond 100° (a bright Moon brightens the whole sky).
    """
    up = np.asarray(moon_alt) > RISE_SET_ALT_DEG
    g = np.clip((120.0 - np.asarray(sep_deg)) / 100.0, 0.2, 1.0)
    return np.where(up, clamp01(np.asarray(illum)) * g, 0.0)


def target_moon_points(mean_interference: float, emission: bool) -> float:
    sens = EMISSION_MOON_SENSITIVITY if emission else 1.0
    return float(TARGET_WEIGHTS["moon"] * (1.0 - clamp01(mean_interference * sens)))


def weather_points(cloud_pct, precip_pct) -> float:
    per = 0.7 * (1 - clamp01(np.asarray(cloud_pct) / 100.0)) + 0.3 * (1 - clamp01(np.asarray(precip_pct) / 100.0))
    return float(TARGET_WEIGHTS["weather"] * float(np.mean(per)))


def fit_notes(target: dict[str, Any], equipment: dict[str, Any] | None) -> list[str]:
    """Advisory framing notes. They never change the score: the S30 FOV axis is unverified."""
    if not equipment or not equipment.get("fov_deg"):
        return []
    fov_arcmin = float(equipment["fov_deg"]) * 60
    major = target.get("angular_major_arcmin")
    qual = "" if equipment.get("fov_definition") not in (None, "unknown") else " (FOV axis unverified)"
    if not major:
        return [f"Catalog size unavailable, so framing vs the ~{equipment['fov_deg']}° field is unknown."]
    if major > fov_arcmin:
        return [f"Catalog size {major:.0f}′ exceeds the ~{fov_arcmin:.0f}′ field{qual}: expect partial framing or a mosaic."]
    if major > 0.75 * fov_arcmin:
        return [f"Catalog size {major:.0f}′ fills most of the ~{fov_arcmin:.0f}′ field{qual}."]
    if major < fov_arcmin / 15:
        return [f"Small at this focal length: {major:.1f}′ across vs a ~{fov_arcmin:.0f}′ field{qual}."]
    return []


def night_clear(ctx: SkyContext, weather: dict[str, np.ndarray] | None, darkness: str) -> dict | None:
    """Longest run of darkness samples whose forecast is clear (the rule of ``_favorable_window``).

    Missing (NaN) forecast values never count as clear. None when there is no forecast,
    no darkness, or no clear sample.
    """
    if weather is None:
        return None
    dark = ctx.sun_alt < DARKNESS_THRESHOLDS[darkness]
    clear = (
        dark
        & (weather["cloud_cover"] <= FAVORABLE_CLOUD_PCT)
        & (weather["precipitation_probability"] <= FAVORABLE_PRECIP_PCT)
    )
    rs = runs(clear)
    if not rs:
        return None
    s, e = max(rs, key=lambda r: r[1] - r[0])
    step = float(ctx.t[1] - ctx.t[0])
    dark_idx = np.nonzero(dark)[0]
    start = float(ctx.t[s])
    end = min(float(ctx.t[e]) + step, float(ctx.t[dark_idx[-1]]) + step)
    return {
        "start_utc": iso_utc(start), "end_utc": iso_utc(end),
        "minutes": round((end - start) / 60, 1),
        "rule": f"cloud ≤ {FAVORABLE_CLOUD_PCT:.0f}% and precipitation probability ≤ {FAVORABLE_PRECIP_PCT:.0f}%",
    }


def _favorable_window(ctx: SkyContext, vis: TargetVisibility, cloud: np.ndarray, precip: np.ndarray) -> dict | None:
    fav = vis.window_mask & (cloud <= FAVORABLE_CLOUD_PCT) & (precip <= FAVORABLE_PRECIP_PCT)
    rs = runs(fav)
    if not rs:
        return None
    s, e = max(rs, key=lambda r: r[1] - r[0])
    step = float(ctx.t[1] - ctx.t[0])
    start = max(float(ctx.t[s]), vis.best_window[0])
    end = min(float(ctx.t[e]) + step, vis.best_window[1])
    return {
        "start_utc": iso_utc(start), "end_utc": iso_utc(end),
        "minutes": round((end - start) / 60, 1),
        "rule": f"cloud ≤ {FAVORABLE_CLOUD_PCT:.0f}% and precipitation probability ≤ {FAVORABLE_PRECIP_PCT:.0f}%",
    }


def target_score(
    ctx: SkyContext,
    vis: TargetVisibility,
    target: dict[str, Any],
    weather: dict[str, np.ndarray] | None,
    equipment: dict[str, Any] | None,
    min_alt_deg: float,
) -> dict[str, Any]:
    tz = ctx.timezone
    cautions = fit_notes(target, equipment)
    if vis.status != "observable" or vis.best_window is None:
        return {"kind": "heuristic", "total": None, "max_total": None, "normalized": None,
                "components": [], "why": [], "cautions": cautions, "forecast_window": None}

    m = vis.window_mask
    alt = ctx.target_alt[vis.index][m]
    med_x = float(np.median(airmass(alt)))
    emission = bool(target.get("emission_line_dominant"))
    interf = moon_interference(ctx.moon_illum[m], ctx.moon_alt[m], vis.moon_sep[m])
    moon_up = ctx.moon_alt[m] > RISE_SET_ALT_DEG

    if moon_up.any():
        moon_detail = (
            f"Moon up {moon_up.mean() * 100:.0f}% of the window, {float(ctx.moon_illum[m].mean()) * 100:.0f}% lit, "
            f"nearest {float(vis.moon_sep[m][moon_up].min()):.0f}° away"
            + (" (emission-line target: half sensitivity)" if emission else "")
        )
    else:
        moon_detail = "Moon below the horizon throughout the window"

    comps = [
        {"key": "altitude", "label": "Altitude", "points": _r(altitude_points(med_x)), "max": TARGET_WEIGHTS["altitude"],
         "basis": "calculated", "detail": f"Median airmass {med_x:.2f} (median altitude {float(np.median(alt)):.0f}°) in the window"},
        {"key": "duration", "label": "Imaging time", "points": _r(duration_points(vis.best_window_minutes)), "max": TARGET_WEIGHTS["duration"],
         "basis": "calculated", "detail": f"{vis.best_window_minutes / 60:.1f} h contiguous above {min_alt_deg:.0f}° in darkness (4 h = full)"},
        {"key": "moon", "label": "Moon interference", "points": _r(target_moon_points(float(interf.mean()), emission)),
         "max": TARGET_WEIGHTS["moon"], "basis": "calculated", "detail": moon_detail},
    ]

    forecast_window = None
    cloud = weather.get("cloud_cover") if weather else None
    precip = weather.get("precipitation_probability") if weather else None
    if cloud is not None and precip is not None and not (np.isnan(cloud[m]).any() or np.isnan(precip[m]).any()):
        mean_cloud = float(cloud[m].mean())
        comps.append({"key": "weather", "label": "Forecast weather", "points": _r(weather_points(cloud[m], precip[m])),
                      "max": TARGET_WEIGHTS["weather"], "basis": "forecast",
                      "detail": f"Mean cloud {mean_cloud:.0f}%, mean precipitation probability {float(precip[m].mean()):.0f}% in the window"})
        forecast_window = _favorable_window(ctx, vis, cloud, precip)
        if mean_cloud >= 70:
            cautions.append(f"Forecast cloud cover averages {mean_cloud:.0f}% during the window.")
        if forecast_window is None:
            cautions.append("No part of the window meets the favorable-forecast rule (≤40% cloud, ≤30% precip.).")
    else:
        comps.append({"key": "weather", "label": "Forecast weather", "points": None, "max": TARGET_WEIGHTS["weather"],
                      "basis": "forecast", "detail": "Forecast unavailable for this window; excluded from the total"})
        cautions.append("No forecast for this window: score covers geometry and Moon only.")

    scored = [c for c in comps if c["points"] is not None]
    total = round(sum(c["points"] for c in scored), 1)
    max_total = sum(c["max"] for c in scored)

    why = [
        f"Above {min_alt_deg:.0f}° for {vis.best_window_minutes / 60:.1f} h of darkness "
        f"({local_hhmm(vis.best_window[0], tz)}–{local_hhmm(vis.best_window[1], tz)})",
    ]
    if vis.max_alt_dark_deg is not None:
        why.append(f"Peaks at {vis.max_alt_dark_deg:.0f}° in darkness around {local_hhmm(vis.max_alt_dark_utc, tz)}")
    if not moon_up.any():
        why.append("Moon stays below the horizon during the window")
    elif emission:
        why.append("Emission-line target: less affected by moonlight (heuristic)")
    if forecast_window:
        why.append(
            f"Forecast-favorable {local_hhmm(_ts(forecast_window['start_utc']), tz)}–"
            f"{local_hhmm(_ts(forecast_window['end_utc']), tz)}"
        )
    if moon_up.any():
        near = float(vis.moon_sep[m][moon_up].min())
        if near < 30:
            cautions.append(f"Moon comes within {near:.0f}° of the target while up.")
    if vis.best_window_minutes < 90:
        cautions.append("Short window: limited total integration time.")

    return {
        "kind": "heuristic",
        "total": total,
        "max_total": max_total,
        "normalized": round(total / max_total * 100, 1) if max_total else None,
        "components": comps,
        "why": why[:4],
        "cautions": cautions[:4],
        "forecast_window": forecast_window,
    }


def _ts(iso: str) -> float:
    from datetime import datetime
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
