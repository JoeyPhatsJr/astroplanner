"""Sky alerts (spec §7.2): a notable change backed by independent reports, with explicit freshness.

Rule: within the last 48 h of cached observations, at least ``min_observers`` distinct observers
(by opaque hash, never returned) report a positive V/visual detection brighter than the star's
threshold. Freshness comes from the fetch log: never fetched successfully → ``unavailable``; no
successful fetch in 24 h or the latest fetch failed → ``stale`` (never "no change", and never
"alert": ruling R12, freshness is checked first). A stale row keeps its ``evidence`` so the UI can
say what the last data showed; ``checked_utc`` and ``last_error`` say how old it is. Only a fresh
row is decided by the evidence: ``alert`` or ``no_change``.

Episodes (ruling R5): an alert episode starts at the earliest observation of the current run of
daily means brighter than the threshold; only a daily mean at or fainter than the threshold ends a
run (days without data do not). Dismissing stores the episode start; the alert stays hidden while
that start lies inside the current episode, and a later episode alerts again.
"""

from __future__ import annotations

import statistics
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.variables import cache
from app.variables.aavso import Observation
from app.variables.curve import daily_means, included
from app.variables.models import VariableAlertDismissal

WINDOW_HOURS = 48
STALE_AFTER = timedelta(hours=24)
_EPS_JD = 1e-6


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def evaluate(observations: list[Observation], star: dict[str, Any], now: datetime,
             status: dict[str, Any]) -> dict[str, Any]:
    rule = star["alert"]
    threshold = rule["brighter_than"]
    since = cache.to_jd(now) - WINDOW_HOURS / 24
    recent = [o for o in observations if included(o) and o.jd >= since]
    bright_observers = {o.observer_hash for o in recent if o.mag < threshold}
    last_ok = status.get("last_ok_utc")
    if last_ok is None:
        state = "unavailable"
    elif status.get("last_error") or now - _parse_iso(last_ok) > STALE_AFTER:
        state = "stale"
    elif len(bright_observers) >= rule["min_observers"]:
        state = "alert"
    else:
        state = "no_change"
    return {
        "star_id": star["id"],
        "state": state,
        "evidence": {"observers": len(bright_observers), "threshold": threshold, "window_hours": WINDOW_HOURS,
                     "brightest": min((o.mag for o in recent), default=None)},
        "current_mag": round(statistics.median(o.mag for o in recent), 2) if recent else None,
        "normal_text": rule["normal_text"],
        "checked_utc": last_ok,
        "last_error": status.get("last_error"),
    }


def episode(observations: list[Observation], threshold: float, now_jd: float) -> tuple[float, float] | None:
    """(start JD, latest JD) of the current alert episode, or None when nothing is brighter.

    The run ends at the latest bright daily mean if that day reaches into the 48 h window (today's
    mean may already dip while bright reports from yesterday still raise the alert); otherwise the
    episode is the span of the bright reports inside the window.
    """
    since = now_jd - WINDOW_HOURS / 24
    obs = [o for o in observations if included(o)]
    daily = daily_means((o.jd, o.mag) for o in obs)
    last = next((i for i in range(len(daily) - 1, -1, -1) if daily[i].mean < threshold), None)
    if last is not None and daily[last].last_jd >= since:
        first = last
        while first > 0 and daily[first - 1].mean < threshold:
            first -= 1
        return daily[first].first_jd, daily[last].last_jd
    bright = [o.jd for o in obs if o.jd >= since and o.mag < threshold]
    return (min(bright), max(bright)) if bright else None


def current(db: Session, star: dict[str, Any], now: datetime) -> tuple[dict[str, Any], tuple[float, float] | None]:
    """Evaluate a star from the cache only (no provider call); the episode is computed only for an alert."""
    now_jd = cache.to_jd(now)
    status = cache.status(db, star["id"], now, days=cache.ALERT_DAYS)
    result = evaluate(cache.cached_observations(db, star["id"], now_jd - WINDOW_HOURS / 24, now_jd),
                      star, now, status)
    if result["state"] != "alert":
        return result, None
    history = cache.cached_observations(db, star["id"], now_jd - cache.HISTORY_DAYS, now_jd)
    return result, episode(history, star["alert"]["brighter_than"], now_jd)


def is_dismissed(db: Session, star_id: str, ep: tuple[float, float] | None) -> bool:
    if ep is None:
        return False
    d = db.scalars(select(VariableAlertDismissal).where(VariableAlertDismissal.star_id == star_id)).first()
    # "Inside" rather than "equal": a history fill that later back-fills older bright days moves the
    # computed start earlier without starting a new episode.
    return d is not None and ep[0] - _EPS_JD <= d.alert_since_jd <= ep[1] + _EPS_JD


def dismiss(db: Session, star_id: str, ep: tuple[float, float], now: datetime) -> None:
    d = db.scalars(select(VariableAlertDismissal).where(VariableAlertDismissal.star_id == star_id)).first()
    if d is None:
        d = VariableAlertDismissal(star_id=star_id)
        db.add(d)
    d.dismissed_at = now.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    d.alert_since_jd = ep[0]
    db.commit()
