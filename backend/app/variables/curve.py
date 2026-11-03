"""Light-curve data from the AAVSO observation cache (spec §7.3).

Only positive detections (``fainter_than`` False) in the V and visual bands are plotted or
averaged; fainter-than limits and other bands stay in the cache but never reach a curve, an
alert or an outburst window. The curve endpoint answers from the cache at once and leaves the
history fill (many 2 s-spaced requests) to a background task, see ``run_fill``.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.astrolog.library import UNIX_JD_EPOCH
from app.db import Database
from app.variables import cache
from app.variables.aavso import AavsoProvider, Observation
from app.variables.models import VariableObservation

log = logging.getLogger(__name__)

INCLUDED_BANDS = ("V", "Vis.")
EXCLUDED_NOTE = "Fainter-than estimates and other bands are not plotted."
MAX_POINTS = 3000
RECENT = "recent"


def included(o: Observation) -> bool:
    return not o.fainter_than and o.band in INCLUDED_BANDS


def jd_to_date(jd: float) -> date:
    """UT calendar date of a Julian Date."""
    return (datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(days=jd - UNIX_JD_EPOCH)).date()


@dataclass(frozen=True)
class DailyMean:
    day: date  # UT date
    mean: float
    n: int
    first_jd: float
    last_jd: float


def daily_means(points: Iterable[tuple[float, float]]) -> list[DailyMean]:
    """Mean magnitude per UT date from ``(jd, mag)`` pairs (already filtered to included rows), ascending."""
    days: dict[date, list[tuple[float, float]]] = {}
    for jd, mag in points:
        days.setdefault(jd_to_date(jd), []).append((jd, mag))
    return [DailyMean(day=d, mean=sum(m for _, m in v) / len(v), n=len(v),
                      first_jd=min(j for j, _ in v), last_jd=max(j for j, _ in v))
            for d, v in sorted(days.items())]


def downsample(seq: Sequence, max_points: int = MAX_POINTS) -> tuple[list, int]:
    """Every Nth item, with the smallest N that keeps at most ``max_points``; returns (items, N)."""
    n = max(1, math.ceil(len(seq) / max_points))
    return list(seq[::n]), n


@dataclass(frozen=True)
class Window:
    key: str
    label: str
    from_date: str | None = None  # fixed windows only (ISO dates, inclusive)
    to_date: str | None = None

    def jd_range(self, now: datetime) -> tuple[float, float]:
        if self.from_date is None:
            hi = cache.to_jd(now)
            return hi - cache.HISTORY_DAYS, hi
        return cache._window_jd(self.from_date, self.to_date)

    def status(self, db: Session, star_id: str, now: datetime) -> dict[str, Any]:
        if self.from_date is None:
            return cache.status(db, star_id, now)
        return cache.status(db, star_id, now, window=(self.from_date, self.to_date))

    def view(self) -> dict[str, Any]:
        return {"key": self.key, "label": self.label, "from_date": self.from_date, "to_date": self.to_date}


def resolve_window(star: dict[str, Any], key: str) -> Window | None:
    if key == RECENT:
        return Window(RECENT, f"Last {cache.HISTORY_DAYS} days")
    for w in star.get("history_windows") or []:
        if w["key"] == key:
            return Window(w["key"], w["label"], w["from_date"], w["to_date"])
    return None


def load_points(db: Session, star_id: str, lo: float, hi: float) -> tuple[int, list[tuple[float, float, str]]]:
    """(all cached observations in the range, included ``(jd, mag, band)`` rows ordered by JD).

    A column query rather than ``cache.cached_observations``: a year of T CrB is ~10^5 rows, and the
    page polls this while the history loads.
    """
    in_range = (VariableObservation.star_id == star_id) & (VariableObservation.jd >= lo) & (VariableObservation.jd <= hi)
    cached = db.scalar(select(func.count()).select_from(VariableObservation).where(in_range)) or 0
    rows = db.execute(select(VariableObservation.jd, VariableObservation.mag, VariableObservation.band).where(
        in_range, VariableObservation.fainter_than.is_(False), VariableObservation.band.in_(INCLUDED_BANDS),
    ).order_by(VariableObservation.jd, VariableObservation.id)).all()
    return cached, [(jd, mag, band) for jd, mag, band in rows]


def payload(db: Session, star: dict[str, Any], window: Window, now: datetime,
            attribution: list[str]) -> dict[str, Any]:
    """What is cached now for the window (no provider call)."""
    lo, hi = window.jd_range(now)
    cached, rows = load_points(db, star["id"], lo, hi)
    plotted, every_nth = downsample(rows)
    return {
        "window": window.view(),
        "points": [[round(jd, 5), round(mag, 3), band] for jd, mag, band in plotted],
        "daily": [[d.day.isoformat(), round(d.mean, 2), d.n] for d in daily_means((jd, mag) for jd, mag, _ in rows)],
        "counts": {"cached": cached, "plotted_points": len(plotted), "every_nth": every_nth, "included": len(rows)},
        "bands_included": list(INCLUDED_BANDS),
        "excluded_note": EXCLUDED_NOTE,
        "status": window.status(db, star["id"], now),
        "attribution": attribution,
    }


def run_fill(database: Database, provider: AavsoProvider, star: dict[str, Any], window: Window,
             now: datetime) -> None:
    """Background task: fill (or incrementally refresh) the window. A no-op when it is fresh, already
    being filled, or backing off after a failure; failures are recorded in ``variable_fetches``."""
    try:
        with database.session() as s:
            if window.from_date is None:
                cache.fill_history(s, provider, star, now)
            else:
                cache.fill_window(s, provider, star, window.from_date, window.to_date, now=now)
    except Exception as exc:  # never let a background task die loudly; the status shows the gap
        log.warning("History fill for %s (%s) failed: %s", star["id"], window.key, type(exc).__name__)
