"""Mission progress derived from AstroLog nights (the session's own noon-to-noon `local_night_date`)."""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import select

from app.astrolog.models import CaptureSet, LibraryTarget
from app.db import Database, ObservingSession


def star_nights(db: Database, star_id: str) -> list[date]:
    """Distinct observer-local night dates with a capture set of this star, ascending."""
    with db.session() as s:
        rows = s.scalars(
            select(ObservingSession.local_night_date)
            .join(CaptureSet, CaptureSet.session_id == ObservingSession.id)
            .join(LibraryTarget, LibraryTarget.id == CaptureSet.library_target_id)
            .where(LibraryTarget.catalog_target_id == star_id)
            .distinct()
        ).all()
    return sorted(date.fromisoformat(r) for r in rows)


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def weekly_streak(nights: list[date], today: date) -> int:
    """Consecutive ISO weeks with at least one night, ending at this week (or last week if none yet)."""
    weeks = {_week_start(n) for n in nights}
    cur = _week_start(today)
    if cur not in weeks:
        cur -= timedelta(weeks=1)
    n = 0
    while cur in weeks:
        n += 1
        cur -= timedelta(weeks=1)
    return n


def monthly_count(nights: list[date], today: date, months: int = 6) -> int:
    """Distinct calendar months with a night among the last `months` months, current month included."""
    now_idx = today.year * 12 + today.month - 1
    idx = {n.year * 12 + n.month - 1 for n in nights}
    return sum(1 for i in idx if now_idx - months < i <= now_idx)


def outburst_nights(nights: list[date], windows: list[tuple[date, date]]) -> int:
    """Most nights falling inside any single window (inclusive)."""
    return max((sum(1 for n in nights if a <= n <= b) for a, b in windows), default=0)
