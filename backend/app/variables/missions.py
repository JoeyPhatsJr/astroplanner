"""Mission progress derived from AstroLog nights (the session's own noon-to-noon `local_night_date`)."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select

from app.astrolog.models import CaptureSet, LibraryTarget
from app.db import Database, ObservingSession
from app.variables import cache, curve


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


def outburst_windows(daily: list[curve.DailyMean], threshold: float) -> list[tuple[date, date]]:
    """Runs of consecutive UT days whose daily mean is brighter than ``threshold`` (a day without data ends a run)."""
    out: list[tuple[date, date]] = []
    for d in daily:
        if d.mean >= threshold:
            continue
        if out and out[-1][1] + timedelta(days=1) == d.day:
            out[-1] = (out[-1][0], d.day)
        else:
            out.append((d.day, d.day))
    return out


def cached_outburst_windows(db: Database, star: dict[str, Any], nights: list[date]) -> list[tuple[date, date]]:
    """Outburst windows from the cached AAVSO daily means around the developer's nights (none → no query)."""
    if not nights or not star.get("alert"):
        return []
    lo = cache.to_jd(datetime.combine(min(nights) - timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc))
    hi = cache.to_jd(datetime.combine(max(nights) + timedelta(days=2), datetime.min.time(), tzinfo=timezone.utc))
    with db.session() as s:
        _, rows = curve.load_points(s, star["id"], lo, hi)
    return outburst_windows(curve.daily_means((jd, mag) for jd, mag, _ in rows), star["alert"]["brighter_than"])
