"""Threshold-crossing and interval helpers on regularly sampled time series.

All times are UNIX seconds (UTC). Boundaries are refined by linear interpolation
between the two samples that straddle a threshold, so a 5-minute grid yields
boundary estimates far better than +/-5 minutes for smooth curves such as
altitude.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Crossing:
    t: float  # UNIX seconds
    rising: bool  # True if the series goes from below to above the threshold


@dataclass(frozen=True)
class Condition:
    """A per-sample condition ``values < threshold`` (below=True) or ``values >= threshold``."""

    values: np.ndarray
    threshold: float
    below: bool

    def mask(self) -> np.ndarray:
        v = self.values
        return (v < self.threshold) if self.below else (v >= self.threshold)


def _interp_time(t0: float, t1: float, y0: float, y1: float, thr: float) -> float:
    if y1 == y0:
        return t0
    frac = (thr - y0) / (y1 - y0)
    frac = min(max(frac, 0.0), 1.0)
    return t0 + frac * (t1 - t0)


def crossings(t: np.ndarray, y: np.ndarray, threshold: float) -> list[Crossing]:
    """Every crossing of ``threshold`` by ``y`` with interpolated time and direction."""
    above = y >= threshold
    flips = np.nonzero(above[1:] != above[:-1])[0]
    out: list[Crossing] = []
    for i in flips:
        tc = _interp_time(float(t[i]), float(t[i + 1]), float(y[i]), float(y[i + 1]), threshold)
        out.append(Crossing(t=tc, rising=bool(above[i + 1])))
    return out


def first_crossing(t: np.ndarray, y: np.ndarray, threshold: float, rising: bool) -> float | None:
    for c in crossings(t, y, threshold):
        if c.rising == rising:
            return c.t
    return None


def _boundary(t: np.ndarray, conds: list[Condition], i_out: int, i_in: int, start: bool) -> float:
    """Interpolated boundary between sample ``i_out`` (mask False) and ``i_in`` (mask True)."""
    times: list[float] = []
    for c in conds:
        m_out = bool(c.mask()[i_out])
        if not m_out:  # this condition flipped across the boundary
            times.append(
                _interp_time(
                    float(t[i_out]), float(t[i_in]),
                    float(c.values[i_out]), float(c.values[i_in]), c.threshold,
                )
            )
    if not times:
        return float(t[i_in])
    # For a start boundary all conditions must already hold -> latest crossing.
    # For an end boundary the first condition to fail ends it -> earliest crossing.
    return max(times) if start else min(times)


def intervals(t: np.ndarray, conds: list[Condition]) -> list[tuple[float, float]]:
    """Contiguous intervals where all conditions hold, as (start, end) UNIX seconds.

    An interval that touches the edge of the sampled span is clipped to the span.
    """
    if not conds:
        return []
    mask = np.logical_and.reduce([c.mask() for c in conds])
    if not mask.any():
        return []
    padded = np.concatenate([[False], mask, [False]])
    diff = np.diff(padded.astype(np.int8))
    starts = np.nonzero(diff == 1)[0]
    ends = np.nonzero(diff == -1)[0] - 1  # inclusive index of last True
    out: list[tuple[float, float]] = []
    n = len(t)
    for s, e in zip(starts, ends):
        ts = float(t[0]) if s == 0 else _boundary(t, conds, s - 1, s, start=True)
        te = float(t[-1]) if e == n - 1 else _boundary(t, conds, e + 1, e, start=False)
        if te > ts:
            out.append((ts, te))
    return out


def total_seconds(spans: list[tuple[float, float]]) -> float:
    return float(sum(e - s for s, e in spans))


def longest(spans: list[tuple[float, float]]) -> tuple[float, float] | None:
    return max(spans, key=lambda se: se[1] - se[0]) if spans else None
