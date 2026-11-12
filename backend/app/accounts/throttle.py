"""In-memory failure throttle (sign-in per email, sign-up per client address, password change per user).

After ``limit`` counted attempts within ``window`` a key is locked for ``lockout``; it unlocks once
``now >= locked_until`` and its old attempts are forgotten. State lives on the instance (kept on
``app.state``), never in a module global, and resets when the server restarts.

Routes use ``try_acquire``: in one lock acquisition it refuses a locked key or counts the attempt in
advance, so concurrent requests cannot all pass the check before any of them is counted. On success
the caller ``clear``s the key (sign-in) or ``release``s its reservation (sign-up).
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from datetime import datetime, timedelta

MAX_KEYS = 10_000  # past this, stale keys are pruned so unknown emails cannot grow memory without bound


class Throttle:
    def __init__(self, clock: Callable[[], datetime], limit: int = 5,
                 window: timedelta = timedelta(minutes=15), lockout: timedelta = timedelta(minutes=15)):
        self._clock = clock
        self.limit = limit
        self.window = window
        self.lockout = lockout
        self._attempts: dict[str, list[datetime]] = {}
        self._locked_until: dict[str, datetime] = {}
        self._lock = threading.Lock()

    def try_acquire(self, key: str) -> bool:
        """False if ``key`` is locked; otherwise count this attempt now (as a failure) and return True."""
        with self._lock:
            now = self._clock()
            if self._is_locked(key, now):
                return False
            self._record(key, now)
            return True

    def release(self, key: str) -> None:
        """Un-count one reserved attempt that turned out not to be a failure."""
        with self._lock:
            attempts = self._attempts.get(key)
            if attempts:
                attempts.pop()
            if key in self._locked_until and len(attempts or []) < self.limit:
                del self._locked_until[key]

    def locked(self, key: str) -> bool:
        with self._lock:
            return self._is_locked(key, self._clock())

    def fail(self, key: str) -> None:
        with self._lock:
            self._record(key, self._clock())

    def clear(self, key: str) -> None:
        with self._lock:
            self._attempts.pop(key, None)
            self._locked_until.pop(key, None)

    # -- under self._lock -----------------------------------------------------------------------

    def _is_locked(self, key: str, now: datetime) -> bool:
        until = self._locked_until.get(key)
        if until is None:
            return False
        if now >= until:
            del self._locked_until[key]
            self._attempts.pop(key, None)
            return False
        return True

    def _record(self, key: str, now: datetime) -> None:
        recent = [t for t in self._attempts.get(key, []) if now - t < self.window]
        recent.append(now)
        self._attempts[key] = recent
        if len(recent) >= self.limit:
            self._locked_until[key] = now + self.lockout
        if len(self._attempts) + len(self._locked_until) > MAX_KEYS:
            self._prune(now)

    def _prune(self, now: datetime) -> None:
        self._locked_until = {k: v for k, v in self._locked_until.items() if now < v}
        self._attempts = {k: v for k, v in self._attempts.items()
                          if k in self._locked_until or (v and now - v[-1] < self.window)}
