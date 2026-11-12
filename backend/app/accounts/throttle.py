"""In-memory failure throttle (sign-in per email, sign-up per client address).

After ``limit`` failures within ``window`` a key is locked for ``lockout``; it unlocks once
``now >= locked_until`` and its old failures are forgotten. State lives on the instance (kept on
``app.state``), never in a module global, and resets when the server restarts.
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
        self._failures: dict[str, list[datetime]] = {}
        self._locked_until: dict[str, datetime] = {}
        self._lock = threading.Lock()

    def locked(self, key: str) -> bool:
        with self._lock:
            until = self._locked_until.get(key)
            if until is None:
                return False
            if self._clock() >= until:
                del self._locked_until[key]
                self._failures.pop(key, None)
                return False
            return True

    def fail(self, key: str) -> None:
        with self._lock:
            now = self._clock()
            recent = [t for t in self._failures.get(key, []) if now - t < self.window]
            recent.append(now)
            if len(recent) >= self.limit:
                self._locked_until[key] = now + self.lockout
                self._failures.pop(key, None)
            else:
                self._failures[key] = recent
            if len(self._failures) + len(self._locked_until) > MAX_KEYS:
                self._prune(now)

    def clear(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)
            self._locked_until.pop(key, None)

    def _prune(self, now: datetime) -> None:
        self._failures = {k: v for k, v in self._failures.items() if v and now - v[-1] < self.window}
        self._locked_until = {k: v for k, v in self._locked_until.items() if now < v}
