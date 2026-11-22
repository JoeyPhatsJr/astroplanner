"""Regression: the night endpoints must keep working after the bundled IERS table ages.

Production returned HTTP 500 for every night once the bundled astropy-iers-data
table's last measured Earth-orientation value was more than 30 days older than the
server clock (astropy's default ``auto_max_age``). These tests fake a wall clock
well past the table so they fail without the fix whatever today's date is.
"""

from __future__ import annotations

from datetime import date

import pytest
from astropy.time import Time
from astropy.utils import iers
from astropy.utils.iers import iers as iers_module

from app.astronomy import night_summary, sky_context

from .conftest import PHILLY_PARAMS


@pytest.fixture
def clock_far_past_bundled_table(monkeypatch):
    table = iers.IERS_Auto.open()
    fake_now = Time(table.meta["predictive_mjd"] + 400, format="mjd")

    class LateTime(Time):
        @classmethod
        def now(cls):
            return fake_now

    monkeypatch.setattr(iers_module, "Time", LateTime)
    sky_context.cache_clear()
    yield fake_now
    sky_context.cache_clear()


def test_bundled_iers_predictions_are_accepted_whatever_their_age():
    assert iers.conf.auto_download is False
    assert iers.conf.auto_max_age is None


def _night_after_last_measurement() -> date:
    mjd = iers.IERS_Auto.open().meta["predictive_mjd"] + 10
    return date.fromisoformat(Time(mjd, format="mjd").iso[:10])


def test_sky_context_with_stale_bundled_table(clock_far_past_bundled_table):
    ctx = sky_context(39.9526, -75.1652, 0.0, _night_after_last_measurement(), "America/New_York")
    assert night_summary(ctx)["events"]["sunset_utc"] is not None


def test_night_endpoint_with_stale_bundled_table(client, clock_far_past_bundled_table):
    params = {**PHILLY_PARAMS, "date": _night_after_last_measurement().isoformat()}
    r = client.get("/api/night", params=params)
    assert r.status_code == 200, r.text
