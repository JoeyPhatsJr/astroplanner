"""Concurrent requests for the same night share one sky computation (a page asks for several at once)."""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date

from app import astronomy


def test_concurrent_calls_for_one_night_compute_it_once(monkeypatch):
    astronomy.sky_context.cache_clear()
    calls = []
    real = astronomy.build_grid

    def slow_build_grid(night_date, tz_name):
        calls.append(threading.get_ident())
        time.sleep(0.2)  # long enough that every thread arrives while the first is still computing
        return real(night_date, tz_name)

    monkeypatch.setattr(astronomy, "build_grid", slow_build_grid)
    args = (12.3456, 45.6789, 10.0, date(2026, 6, 1), "UTC")
    with ThreadPoolExecutor(max_workers=6) as ex:
        results = list(ex.map(lambda _: astronomy.sky_context(*args), range(6)))
    assert len(calls) == 1
    assert all(r is results[0] for r in results)
    assert astronomy._inflight == {}  # no locks left behind
    astronomy.sky_context.cache_clear()


def test_different_nights_still_compute_independently(monkeypatch):
    astronomy.sky_context.cache_clear()
    a = astronomy.sky_context(1.0, 2.0, 0.0, date(2026, 6, 1), "UTC")
    b = astronomy.sky_context(1.0, 2.0, 0.0, date(2026, 6, 2), "UTC")
    assert a.night_date != b.night_date
    assert astronomy.sky_context(1.0, 2.0, 0.0, date(2026, 6, 1), "UTC") is a  # cached
    astronomy.sky_context.cache_clear()


def test_a_failed_computation_is_not_cached_and_releases_its_lock(monkeypatch):
    astronomy.sky_context.cache_clear()
    monkeypatch.setattr(astronomy, "build_grid", lambda *a: (_ for _ in ()).throw(RuntimeError("boom")))
    args = (3.0, 4.0, 0.0, date(2026, 6, 3), "UTC")
    for _ in range(2):
        try:
            astronomy.sky_context(*args)
        except RuntimeError:
            pass
    assert astronomy._inflight == {}
    monkeypatch.undo()
    assert astronomy.sky_context(*args).night_date == date(2026, 6, 3)
    astronomy.sky_context.cache_clear()
