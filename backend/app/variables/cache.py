"""Database cache of AAVSO observations, filled by two separate fetch paths (spec §7.3).

* Alert path: the last ``ALERT_DAYS`` days per star, at most once per ``REFRESH_EVERY``.
* History path: the last ``HISTORY_DAYS`` days in ``CHUNK_DAYS`` chunks, oldest first. Coverage is
  the union of the JD ranges of successful ``history`` fetches, so a fill that fails at chunk 3
  keeps chunks 1-2 and the next call resumes at chunk 3. Once the window is covered, a refresh
  fetches only from the last cached JD, at most once per ``REFRESH_EVERY``.
* Fixed windows (T CrB 1946): fetched once, with the same chunking and resume.
* After a failed request, the same path is not retried for that star for ``FAILURE_BACKOFF``.

Observations are de-duplicated on ``(star_id, obs_id)``: existing keys are read first (portable
across SQLite and Postgres, like Phase 2's ``existing_keys``) under a process-wide write lock, so
overlapping alert and history windows never store an observation twice. Every request is logged
in ``variable_fetches`` with its outcome; error texts are the app's own, never provider payloads.
"""

from __future__ import annotations

import logging
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

from sqlalchemy import func, insert, select
from sqlalchemy.orm import Session

from app.astrolog.library import UNIX_JD_EPOCH
from app.db import AppMeta
from app.variables.aavso import ALERT_TIMEOUT_S, TIMEOUT_S, AavsoError, AavsoProvider, Observation
from app.variables.models import VariableFetch, VariableObservation

log = logging.getLogger(__name__)

SALT_KEY = "aavso_observer_salt"
ALERT_DAYS = 3
HISTORY_DAYS = 365
CHUNK_DAYS = 30
REFRESH_EVERY = timedelta(hours=6)
FAILURE_BACKOFF = timedelta(minutes=30)  # after a failed request, that path waits this long for the star
_EPS_DAYS = 1e-5  # ~1 s: JD ranges closer than this count as touching

_WRITE_LOCK = threading.Lock()
_PATH_LOCKS: dict[str, threading.Lock] = {}
_PATH_LOCKS_GUARD = threading.Lock()


@dataclass
class FetchResult:
    requests: int = 0  # provider calls made
    inserted: int = 0  # new observations stored
    skipped: str | None = None  # why nothing was requested: "fresh" | "covered" | "in_progress" | "backoff"
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None


def to_jd(dt: datetime) -> float:
    return UNIX_JD_EPOCH + dt.timestamp() / 86400.0


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _as_date(d: date | str) -> date:
    return d if isinstance(d, date) else date.fromisoformat(d)


def _window_jd(from_date: date | str, to_date: date | str) -> tuple[float, float]:
    """``from_date`` 00:00 UT to the end of ``to_date`` (both inclusive)."""
    start = datetime.combine(_as_date(from_date), datetime.min.time(), tzinfo=timezone.utc)
    end = datetime.combine(_as_date(to_date) + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    return to_jd(start), to_jd(end)


def observer_salt(db: Session) -> str:
    """The per-installation salt for observer-code hashes, generated once and kept in ``app_meta``."""
    row = db.get(AppMeta, SALT_KEY)
    if row is None or not row.value:
        row = row or AppMeta(key=SALT_KEY)
        row.value = secrets.token_hex(16)
        db.add(row)
        db.commit()
    return row.value


def _path_lock(path: str, star_id: str) -> threading.Lock:
    with _PATH_LOCKS_GUARD:
        return _PATH_LOCKS.setdefault(f"{path}:{star_id}", threading.Lock())


def _fill_lock(star_id: str) -> threading.Lock:
    return _path_lock("history", star_id)


def _in_backoff(row: VariableFetch | None, now: datetime) -> bool:
    """True while a failed request is less than ``FAILURE_BACKOFF`` old (abandoned rows do not count)."""
    return (row is not None and not row.ok and row.finished_at is not None
            and now - _parse_iso(row.finished_at) < FAILURE_BACKOFF)


# ---------- storage ----------

def _existing_obs_ids(db: Session, star_id: str, keys: Iterable[str]) -> set[str]:
    keys = list(set(keys))
    found: set[str] = set()
    for i in range(0, len(keys), 500):
        found |= set(db.scalars(select(VariableObservation.obs_id).where(
            VariableObservation.star_id == star_id, VariableObservation.obs_id.in_(keys[i:i + 500]))))
    return found


def _store(db: Session, star_id: str, observations: list[Observation]) -> int:
    """Insert observations not cached yet (caller holds ``_WRITE_LOCK`` and commits)."""
    fresh: dict[str, Observation] = {}
    for o in observations:
        fresh.setdefault(o.obs_id, o)
    known = _existing_obs_ids(db, star_id, fresh)
    rows = [{"star_id": star_id, "obs_id": o.obs_id, "jd": o.jd, "mag": o.mag, "uncert": o.uncert, "band": o.band,
             "fainter_than": o.fainter_than, "obs_type": o.obs_type, "val": o.val, "observer_hash": o.observer_hash}
            for k, o in fresh.items() if k not in known]
    if rows:
        db.execute(insert(VariableObservation), rows)
    return len(rows)


def cached_observations(db: Session, star_id: str, from_jd: float, to_jd: float) -> list[Observation]:
    rows = db.scalars(select(VariableObservation).where(
        VariableObservation.star_id == star_id, VariableObservation.jd >= from_jd, VariableObservation.jd <= to_jd,
    ).order_by(VariableObservation.jd, VariableObservation.id))
    return [Observation(obs_id=r.obs_id, jd=r.jd, mag=r.mag, uncert=r.uncert, band=r.band, fainter_than=r.fainter_than,
                        obs_type=r.obs_type, val=r.val, observer_hash=r.observer_hash) for r in rows]


def _fetch_range(db: Session, provider: AavsoProvider, star: dict[str, Any], path: str, lo: float, hi: float,
                 stamp, timeout_s: float = TIMEOUT_S) -> tuple[int, str | None]:
    """One logged provider request; returns (observations inserted, error text or None).

    The row is always closed: a failed request, or a failed save after a good one, is recorded as
    not ok so ``FAILURE_BACKOFF`` applies (an open row would make every status poll re-request it)."""
    f = VariableFetch(star_id=star["id"], path=path, from_jd=lo, to_jd=hi, started_at=stamp(), ok=False, rows=0)
    db.add(f)
    db.commit()  # visible as in progress
    error: str | None = None
    try:
        obs = provider.fetch_observations(star["primary_designation"], lo, hi, timeout_s=timeout_s)
    except AavsoError as exc:
        error = str(exc)[:200]
    except Exception as exc:  # a provider bug must still close the fetch row; its message is not kept
        error = f"Unexpected error ({type(exc).__name__})"
    if error:
        log.warning("AAVSO %s fetch for %s failed: %s", path, star["id"], error)
    with _WRITE_LOCK:
        inserted = 0
        try:
            if error is None:
                inserted = _store(db, star["id"], obs)
                f.ok, f.rows = True, len(obs)
            f.error = error
            f.finished_at = stamp()
            db.commit()
        except Exception as exc:  # the database message is not kept (it may quote row values)
            db.rollback()
            inserted, error = 0, f"Could not save AAVSO data ({type(exc).__name__})"
            log.warning("AAVSO %s fetch for %s could not be saved: %s", path, star["id"], error)
            f.ok, f.rows, f.error, f.finished_at = False, 0, error, stamp()
            db.commit()
    return inserted, error


def _stamper(now: datetime):
    """Timestamps that start at ``now`` and advance with real elapsed time during a long fill."""
    t0 = time.monotonic()
    return lambda: _iso(now + timedelta(seconds=time.monotonic() - t0))


# ---------- coverage ----------

def _history_rows(db: Session, star_id: str, lo: float, hi: float) -> list[VariableFetch]:
    return list(db.scalars(select(VariableFetch).where(
        VariableFetch.star_id == star_id, VariableFetch.path == "history",
        VariableFetch.from_jd < hi, VariableFetch.to_jd > lo,
    ).order_by(VariableFetch.id)))


def _covered(rows: list[VariableFetch], lo: float, hi: float) -> list[tuple[float, float]]:
    spans = sorted((max(lo, r.from_jd), min(hi, r.to_jd)) for r in rows if r.ok)
    merged: list[list[float]] = []
    for a, b in spans:
        if merged and a <= merged[-1][1] + _EPS_DAYS:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return [(a, b) for a, b in merged]


def _missing(covered: list[tuple[float, float]], lo: float, hi: float) -> list[tuple[float, float]]:
    out, x = [], lo
    for a, b in covered:
        if a - x > _EPS_DAYS:
            out.append((x, a))
        x = max(x, b)
    if hi - x > _EPS_DAYS:
        out.append((x, hi))
    return out


def _chunks(ranges: list[tuple[float, float]], chunk_days: float) -> list[tuple[float, float]]:
    out = []
    for a, b in ranges:
        x = a
        while b - x > _EPS_DAYS:
            y = min(b, x + chunk_days)
            out.append((x, y))
            x = y
    return out


def _plan(db: Session, star_id: str, lo: float, hi: float, now: datetime,
          incremental: bool) -> tuple[list[tuple[float, float]], str | None]:
    """JD ranges the next fill would request, or ([], reason) when none is due."""
    rows = _history_rows(db, star_id, lo, hi)
    covered = _covered(rows, lo, hi)
    missing = _missing(covered, lo, hi)
    if not missing:
        return [], "fresh" if incremental else "covered"
    latest = rows[-1] if rows else None
    if _in_backoff(latest, now):
        return [], "backoff"
    tail_only = bool(covered) and len(missing) == 1 and missing[0][0] >= covered[-1][1] - _EPS_DAYS
    if incremental and tail_only and latest is not None and latest.ok:
        # Fully covered except the newest stretch, and the last run ended cleanly: refresh, rate-limited.
        if now - _parse_iso(latest.finished_at) < REFRESH_EVERY:
            return [], "fresh"
        max_jd = db.scalar(select(func.max(VariableObservation.jd)).where(
            VariableObservation.star_id == star_id, VariableObservation.jd >= lo, VariableObservation.jd <= hi))
        cov_end = covered[-1][1]
        # From the newest cached observation, but never more than the alert window back: after a long
        # observing gap the stretch since the last observation is already covered by ok fetches.
        start = cov_end if max_jd is None else max(min(max_jd, cov_end), cov_end - ALERT_DAYS)
        return [(start, hi)], None
    return missing, None  # first fill, a hole, or resuming after a failed/abandoned chunk


# ---------- fetch paths ----------

def _fill(db: Session, provider: AavsoProvider, star: dict[str, Any], now: datetime, lo: float, hi: float,
          chunk_days: float, incremental: bool) -> FetchResult:
    lock = _fill_lock(star["id"])
    if not lock.acquire(blocking=False):
        return FetchResult(skipped="in_progress")
    try:
        ranges, reason = _plan(db, star["id"], lo, hi, now, incremental)
        if not ranges:
            return FetchResult(skipped=reason)
        result, stamp = FetchResult(), _stamper(now)
        for a, b in _chunks(ranges, chunk_days):
            inserted, error = _fetch_range(db, provider, star, "history", a, b, stamp)
            result.requests += 1
            result.inserted += inserted
            if error:
                result.error = error
                break
        return result
    finally:
        lock.release()


def refresh_alert_window(db: Session, provider: AavsoProvider, star: dict[str, Any], now: datetime) -> FetchResult:
    """Fetch the last ``ALERT_DAYS`` days, unless an ok alert fetch finished less than 6 h ago or one failed
    less than ``FAILURE_BACKOFF`` ago. Concurrent callers for one star are serialized and re-check freshness."""
    with _path_lock("alert", star["id"]):
        db.expire_all()  # see rows committed by another thread while we waited
        latest_ok = db.scalars(select(VariableFetch).where(
            VariableFetch.star_id == star["id"], VariableFetch.path == "alert", VariableFetch.ok.is_(True),
        ).order_by(VariableFetch.id.desc()).limit(1)).first()
        if latest_ok is not None and now - _parse_iso(latest_ok.finished_at) < REFRESH_EVERY:
            return FetchResult(skipped="fresh")
        latest = db.scalars(select(VariableFetch).where(
            VariableFetch.star_id == star["id"], VariableFetch.path == "alert", VariableFetch.finished_at.is_not(None),
        ).order_by(VariableFetch.id.desc()).limit(1)).first()
        if _in_backoff(latest, now):
            return FetchResult(skipped="backoff")
        hi = to_jd(now)
        inserted, error = _fetch_range(db, provider, star, "alert", hi - ALERT_DAYS, hi, _stamper(now),
                                       timeout_s=ALERT_TIMEOUT_S)
        return FetchResult(requests=1, inserted=inserted, error=error)


def fill_history(db: Session, provider: AavsoProvider, star: dict[str, Any], now: datetime,
                 chunk_days: float = CHUNK_DAYS, days: float = HISTORY_DAYS) -> FetchResult:
    hi = to_jd(now)
    return _fill(db, provider, star, now, hi - days, hi, chunk_days, incremental=True)


def fill_window(db: Session, provider: AavsoProvider, star: dict[str, Any], from_date: date | str,
                to_date: date | str, chunk_days: float = CHUNK_DAYS, now: datetime | None = None) -> FetchResult:
    """A fixed historical window (e.g. T CrB 1946), fetched once."""
    lo, hi = _window_jd(from_date, to_date)
    return _fill(db, provider, star, now or datetime.now(timezone.utc), lo, hi, chunk_days, incremental=False)


def status(db: Session, star_id: str, now: datetime, days: float = HISTORY_DAYS,
           window: tuple[date | str, date | str] | None = None) -> dict[str, Any]:
    """Freshness and coverage of the recent history (or of a fixed ``window``) for the UI and alerts.

    ``loading`` is true while a fill runs or when the next fill would request data, except right
    after a failed chunk (the error is shown instead; a page view after ``FAILURE_BACKOFF`` retries).
    ``last_ok_utc`` / ``last_error`` come only from fetches overlapping the requested range (plus the
    alert path for the recent window), so the 1946 window and today's data never vouch for each other.
    """
    if window is not None:
        lo, hi = _window_jd(*window)
    else:
        hi = to_jd(now)
        lo = hi - days
    in_range = (VariableFetch.path == "history") & (VariableFetch.from_jd < hi) & (VariableFetch.to_jd > lo)
    relevant = (in_range | (VariableFetch.path == "alert")) if window is None else in_range
    last_ok = db.scalars(select(VariableFetch.finished_at).where(
        VariableFetch.star_id == star_id, relevant, VariableFetch.ok.is_(True),
    ).order_by(VariableFetch.id.desc()).limit(1)).first()
    last_done = db.scalars(select(VariableFetch).where(
        VariableFetch.star_id == star_id, relevant, VariableFetch.finished_at.is_not(None),
    ).order_by(VariableFetch.id.desc()).limit(1)).first()
    rows = _history_rows(db, star_id, lo, hi)
    ranges, _ = _plan(db, star_id, lo, hi, now, incremental=window is None)
    latest_failed = bool(rows) and rows[-1].finished_at is not None and not rows[-1].ok
    return {
        "last_ok_utc": last_ok,
        "last_error": last_done.error if last_done is not None and not last_done.ok else None,
        "coverage_days": round(sum(b - a for a, b in _covered(rows, lo, hi))),
        "target_days": round(hi - lo),
        "loading": _fill_lock(star_id).locked() or (bool(ranges) and not latest_failed),
    }
