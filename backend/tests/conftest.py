from __future__ import annotations

import math
from datetime import date, datetime, timezone

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.accounts.core import normalize_email
from app.accounts.models import User
from app.astrolog.storage import LocalStorage
from app.db import Database
from app.main import create_app
from app.sky_images import SkyImageProvider
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


@pytest.fixture(autouse=True)
def _no_live_sky_images(monkeypatch):
    """create_app(db=db) builds a default sky-image provider; keep every test off the network."""
    monkeypatch.setenv("ASTROPLANNER_SKY_IMAGES", "off")


@pytest.fixture
def clear_provider():
    return OpenMeteoProvider(fetch=RecordingFetch(synthetic_open_meteo), now=lambda: FIXED_NOW)


@pytest.fixture
def failing_provider():
    def boom(params):
        raise httpx.ConnectError("offline")
    return OpenMeteoProvider(fetch=RecordingFetch(boom), now=lambda: FIXED_NOW)


OWNER_EMAIL = "owner@example.com"
TEST_PASSWORD = "correct horse battery staple"
CSRF_HEADERS = {"X-Requested-With": "AstroPlanner"}


class AccountClient(TestClient):
    """A TestClient that signs in on ``__enter__``.

    It sends ``X-Requested-With: AstroPlanner`` on every request unless ``csrf=False``; its own sign-up and
    sign-in always send it. With ``account=None`` it stays signed out. ``user_id`` is read from the DB.
    """

    def __init__(self, app: FastAPI, *, account: str | None = OWNER_EMAIL, csrf: bool = True, **kw):
        super().__init__(app, headers=dict(CSRF_HEADERS) if csrf else {}, **kw)
        self.account = account
        self.user_id: str | None = None

    def __enter__(self) -> "AccountClient":
        super().__enter__()
        if self.account is not None:
            self.sign_in(self.account)
        return self

    def sign_in(self, email: str, password: str = TEST_PASSWORD) -> None:
        """Sign up ``email``, or sign in if it already exists (409)."""
        body = {"email": email, "password": password}
        r = self.post("/api/auth/signup", json=body, headers=CSRF_HEADERS)
        if r.status_code == 409:
            r = self.post("/api/auth/login", json=body, headers=CSRF_HEADERS)
        assert r.status_code in (200, 201), r.text
        with self.app.state.db.session() as s:
            self.user_id = s.scalar(select(User.id).where(User.email == normalize_email(email)))


def client_for(app: FastAPI, account: str | None, csrf: bool = True) -> AccountClient:
    """Another client on the same app (use as a context manager), for several users at once."""
    return AccountClient(app, account=account, csrf=csrf)


@pytest.fixture(name="client_for")
def _client_for_fixture():
    return client_for


@pytest.fixture
def make_app(tmp_path):
    def _make(provider, db_path=None, **kw) -> FastAPI:
        def no_network(ra, dec, field):
            raise RuntimeError("sky images are never fetched in tests")
        kw.setdefault("sky_images", SkyImageProvider(tmp_path / "sky-images", fetch=no_network))
        db = Database(f"sqlite:///{db_path or tmp_path / 'test.db'}")
        return create_app(db=db, weather=provider, storage=LocalStorage(tmp_path / "previews"), **kw)
    return _make


@pytest.fixture
def make_client(make_app):
    def _make(provider, db_path=None, *, account: str | None = OWNER_EMAIL, csrf: bool = True, clock=None,
              **kw) -> AccountClient:
        return AccountClient(make_app(provider, db_path, clock=clock, **kw), account=account, csrf=csrf)
    return _make


@pytest.fixture
def client(make_client, clear_provider):
    with make_client(clear_provider) as c:
        yield c


@pytest.fixture
def two_users(make_app, clear_provider):
    """(alice, bob): two signed-in clients on one app. Alice signs up first."""
    app = make_app(clear_provider)
    with client_for(app, "alice@example.com") as alice, client_for(app, "bob@example.com") as bob:
        yield alice, bob


PHILLY_PARAMS = {"lat": 39.9526, "lon": -75.1652, "date": "2026-11-02", "timezone": "America/New_York"}


def isclose_minutes(a: float, b: float, tol_min: float) -> bool:
    return math.isclose(a, b, abs_tol=tol_min * 60)
