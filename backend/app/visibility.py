"""Per-target observability over one night, built on a cached SkyContext."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .astronomy import (
    DARKNESS_THRESHOLDS,
    RISE_SET_ALT_DEG,
    SkyContext,
    iso_utc,
    local_hhmm,
)
from .intervals import Condition, crossings, intervals, longest, total_seconds

DEFAULT_MIN_ALT_DEG = 30.0
DEFAULT_MIN_WINDOW_MIN = 30.0

STATUS_TEXT = {
    "observable": "Observable during darkness",
    "too_brief": "Clears the altitude limit only briefly during darkness",
    "daylight_only": "Above the altitude limit only outside darkness",
    "below_threshold": "Never reaches the altitude limit from this latitude",
    "never_rises": "Never rises from this latitude",
    "no_darkness": "No darkness on this night",
}


def theoretical_altitude_range(dec_deg: float, lat_deg: float) -> tuple[float, float]:
    """(min, max) geometric altitude a fixed star can reach at latitude ``lat``."""
    max_alt = 90.0 - abs(lat_deg - dec_deg)
    min_alt = abs(lat_deg + dec_deg) - 90.0
    return min_alt, max_alt


@dataclass
class TargetVisibility:
    index: int
    status: str
    status_text: str
    windows: list[tuple[float, float]]
    best_window: tuple[float, float] | None
    observable_minutes: float
    best_window_minutes: float
    max_alt_dark_deg: float | None
    max_alt_dark_utc: float | None
    culmination_alt_deg: float
    culmination_utc: float
    rise_utc: float | None
    set_utc: float | None
    circumpolar: bool
    never_rises: bool
    theoretical_max_alt_deg: float
    window_mask: np.ndarray = field(repr=False)  # samples inside the best window
    moon_sep: np.ndarray = field(repr=False)


def analyse_target(
    ctx: SkyContext,
    idx: int,
    dec_deg: float,
    min_alt_deg: float = DEFAULT_MIN_ALT_DEG,
    darkness: str = "astronomical",
    min_window_minutes: float = DEFAULT_MIN_WINDOW_MIN,
) -> TargetVisibility:
    t = ctx.t
    alt = ctx.target_alt[idx]
    thr = DARKNESS_THRESHOLDS[darkness]
    dark = ctx.sun_alt < thr

    th_min, th_max = theoretical_altitude_range(dec_deg, ctx.latitude)
    circumpolar = th_min > 0.0
    never_rises = th_max < 0.0

    windows = intervals(t, [Condition(ctx.sun_alt, thr, below=True), Condition(alt, min_alt_deg, below=False)])
    best = longest(windows)
    best_min = (best[1] - best[0]) / 60 if best else 0.0

    window_mask = np.zeros_like(t, dtype=bool)
    if best:
        window_mask = (t >= best[0]) & (t <= best[1])
        if not window_mask.any():  # window shorter than one step: nearest sample
            window_mask[int(np.argmin(np.abs(t - (best[0] + best[1]) / 2)))] = True

    if dark.any():
        dark_alts = np.where(dark, alt, -np.inf)
        i_max = int(np.argmax(dark_alts))
        max_alt_dark, max_alt_dark_t = float(alt[i_max]), float(t[i_max])
    else:
        max_alt_dark = max_alt_dark_t = None

    i_cul = int(np.argmax(alt))
    cross = crossings(t, alt, 0.0)
    rise = next((c.t for c in cross if c.rising), None)
    sett = next((c.t for c in cross if not c.rising), None)

    if not dark.any():
        status = "no_darkness"
    elif never_rises:
        status = "never_rises"
    elif float(alt.max()) < min_alt_deg:
        status = "below_threshold"
    elif not windows:
        status = "daylight_only"
    elif best_min < min_window_minutes:
        status = "too_brief"
    else:
        status = "observable"

    return TargetVisibility(
        index=idx,
        status=status,
        status_text=STATUS_TEXT[status],
        windows=windows,
        best_window=best,
        observable_minutes=total_seconds(windows) / 60,
        best_window_minutes=best_min,
        max_alt_dark_deg=max_alt_dark,
        max_alt_dark_utc=max_alt_dark_t,
        culmination_alt_deg=float(alt[i_cul]),
        culmination_utc=float(t[i_cul]),
        rise_utc=rise,
        set_utc=sett,
        circumpolar=circumpolar,
        never_rises=never_rises,
        theoretical_max_alt_deg=th_max,
        window_mask=window_mask,
        moon_sep=ctx.moon_separation(idx),
    )


def explain_status(vis: TargetVisibility, ctx: SkyContext, min_alt_deg: float) -> str:
    tz = ctx.timezone
    if vis.status == "never_rises":
        return f"Its declination keeps it below the horizon at latitude {ctx.latitude:.1f}°."
    if vis.status == "below_threshold":
        return f"Peaks at only {vis.culmination_alt_deg:.0f}°, below your {min_alt_deg:.0f}° limit."
    if vis.status == "daylight_only":
        return (
            f"Reaches {vis.culmination_alt_deg:.0f}° around {local_hhmm(vis.culmination_utc, tz)}, "
            f"but only while the sky is not dark; during darkness it peaks at "
            f"{(vis.max_alt_dark_deg or 0):.0f}°."
        )
    if vis.status == "too_brief":
        return f"Only {vis.best_window_minutes:.0f} min above {min_alt_deg:.0f}° during darkness."
    if vis.status == "no_darkness":
        return "The Sun never gets low enough for the selected darkness setting."
    return vis.status_text


def visibility_payload(vis: TargetVisibility, ctx: SkyContext, min_alt_deg: float, include_series: bool) -> dict:
    tz = ctx.timezone
    alt = ctx.target_alt[vis.index]
    out = {
        "status": vis.status,
        "status_text": vis.status_text,
        "status_detail": explain_status(vis, ctx, min_alt_deg),
        "can_observe": vis.status == "observable",
        "min_altitude_deg": min_alt_deg,
        "windows": [{"start_utc": iso_utc(s), "end_utc": iso_utc(e)} for s, e in vis.windows],
        "best_window": (
            {"start_utc": iso_utc(vis.best_window[0]), "end_utc": iso_utc(vis.best_window[1]),
             "minutes": round(vis.best_window_minutes, 1)}
            if vis.best_window else None
        ),
        "observable_minutes": round(vis.observable_minutes, 1),
        "max_alt_dark_deg": None if vis.max_alt_dark_deg is None else round(vis.max_alt_dark_deg, 2),
        "max_alt_dark_utc": iso_utc(vis.max_alt_dark_utc),
        "culmination_alt_deg": round(vis.culmination_alt_deg, 2),
        "culmination_utc": iso_utc(vis.culmination_utc),
        "rise_utc": iso_utc(vis.rise_utc),
        "set_utc": iso_utc(vis.set_utc),
        "circumpolar": vis.circumpolar,
        "never_rises": vis.never_rises,
        "theoretical_max_alt_deg": round(vis.theoretical_max_alt_deg, 2),
        "moon_separation_deg": _moon_sep_summary(vis, ctx),
        "local_times_tz": tz,
    }
    if include_series:
        out["series"] = {
            "t_ms": (ctx.t * 1000).astype(np.int64).tolist(),
            "alt_deg": np.round(alt, 2).tolist(),
            "az_deg": np.round(ctx.target_az[vis.index], 1).tolist(),
            "moon_sep_deg": np.round(vis.moon_sep, 1).tolist(),
        }
    return out


def _moon_sep_summary(vis: TargetVisibility, ctx: SkyContext) -> dict:
    """Separation summary over the best window, else darkness, else the whole span."""
    if vis.window_mask.any():
        sel, basis = vis.window_mask, "best window"
    else:
        sel = ctx.sun_alt < DARKNESS_THRESHOLDS["astronomical"]
        basis = "darkness"
        if not sel.any():
            sel, basis = np.ones_like(ctx.t, dtype=bool), "whole span"
    sep = vis.moon_sep[sel]
    moon_up = ctx.moon_alt[sel] > RISE_SET_ALT_DEG
    return {
        "basis": basis,
        "min": round(float(sep.min()), 1),
        "mean": round(float(sep.mean()), 1),
        "moon_up_fraction": round(float(moon_up.mean()), 3),
    }
