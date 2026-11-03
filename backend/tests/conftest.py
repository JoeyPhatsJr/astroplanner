from __future__ import annotations

import math
from datetime import date, datetime, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from app.astrolog.storage import LocalStorage
from app.db import Database
from app.main import create_app
from app.weather import HOURLY_VARS, OpenMeteoProvider

FIXED_NOW = datetime(2026, 11, 2, 19, 0, tzinfo=timezone.utc)


def synthetic_open_meteo(params: dict, cloud=lambda i: 10.0, precip=lambda i: 0.0) -> httpx.Response:
    """A response shaped like Open-Meteo's, built ONLY for tests (never used by the app)."""
    start = datetime.fromisoformat(params["start_date"]).replace(tzinfo=timezone.utc)
    end = datetime.fromisoformat(params["end_date"]).replace(tzinfo=timezone.utc)
    n = int((end - start).total_seconds() // 3600) + 24
    times = [int(start.timestamp()) + 3600 * i for i in range(n)]
    hourly: dict = {"time": times}
    for v in HOURLY_VARS:
        hourly[v] = [0.0] * n
    hourly["cloud_cover"] = [cloud(i) for i in range(n)]
    hourly["precipitation_probability"] = [precip(i) for i in range(n)]
    body = {"latitude": params["latitude"], "longitude": params["longitude"], "elevation": 10.0,
            "hourly_units": {v: "%" for v in HOURLY_VARS}, "hourly": hourly}
    return httpx.Response(200, json=body)


class RecordingFetch:
    def __init__(self, responder):
        self.responder = responder
        self.calls: list[dict] = []

    def __call__(self, params):
        self.calls.append(params)
        return self.responder(params)


@pytest.fixture
def clear_provider():
    return OpenMeteoProvider(fetch=RecordingFetch(synthetic_open_meteo), now=lambda: FIXED_NOW)


@pytest.fixture
def failing_provider():
    def boom(params):
        raise httpx.ConnectError("offline")
    return OpenMeteoProvider(fetch=RecordingFetch(boom), now=lambda: FIXED_NOW)


@pytest.fixture
def make_client(tmp_path):
    def _make(provider, db_path=None, **kw):
        db = Database(f"sqlite:///{db_path or tmp_path / 'test.db'}")
        return TestClient(create_app(db=db, weather=provider, storage=LocalStorage(tmp_path / "previews"), **kw))
    return _make


@pytest.fixture
def client(make_client, clear_provider):
    with make_client(clear_provider) as c:
        yield c


PHILLY_PARAMS = {"lat": 39.9526, "lon": -75.1652, "date": "2026-11-02", "timezone": "America/New_York"}


def isclose_minutes(a: float, b: float, tol_min: float) -> bool:
    return math.isclose(a, b, abs_tol=tol_min * 60)
