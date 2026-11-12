"""Local accounts: passwords, cookie sessions, throttling, the CSRF header and the reset-password CLI.

Copy strings are written out here on purpose (not imported from the routes) so a typo in a constant fails.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text

from app.accounts.__main__ import main as accounts_cli
from app.accounts.core import AccountInputError, check_password, hash_password, verify_password
from app.accounts.models import UserSession
from tests.conftest import CSRF_HEADERS, TEST_PASSWORD, client_for

COOKIE = "astroplanner_session"
SIGN_IN_FAILED = "That email and password don’t match. Check them, or reset your password."
START = datetime(2026, 11, 11, 20, 0, tzinfo=timezone.utc)
NEW_PASSWORD = "a brand new passphrase"


class FakeClock:
    def __init__(self, now: datetime = START):
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kw) -> None:
        self.now += timedelta(**kw)


def _signup(c, email="ann@example.com", password=TEST_PASSWORD):
    return c.post("/api/auth/signup", json={"email": email, "password": password})


def _login(c, email="ann@example.com", password=TEST_PASSWORD):
    return c.post("/api/auth/login", json={"email": email, "password": password})


def _cookie_attrs(set_cookie: str) -> list[str]:
    return [a.strip().lower() for a in set_cookie.split(";")[1:]]


def test_hash_and_verify():
    h = hash_password(TEST_PASSWORD)
    assert h.startswith("$argon2id$")
    assert verify_password(h, TEST_PASSWORD) is True
    assert verify_password(h, "wrong password entirely") is False
    assert verify_password("garbage", TEST_PASSWORD) is False


def test_password_rules():
    with pytest.raises(AccountInputError) as e:
        check_password("a" * 11)
    assert e.value.message == "Use at least 12 characters."
    with pytest.raises(AccountInputError) as e:
        check_password("a" * 1025)
    assert e.value.message == "Use at most 1024 characters."
    check_password("a" * 12)
    check_password("a" * 1024)


def test_signup_sets_cookie_and_me(make_client, clear_provider):
    with make_client(clear_provider, account=None) as c:
        r = _signup(c, email="  Ann@Example.COM ")
        assert r.status_code == 201, r.text
        body = r.json()
        assert set(body) == {"email", "created_at", "claimed_existing"}
        assert body["email"] == "ann@example.com"
        assert isinstance(body["created_at"], str)
        assert body["claimed_existing"] is False
        sc = r.headers["set-cookie"]
        assert f"{COOKIE}=" in sc
        attrs = _cookie_attrs(sc)
        assert "httponly" in attrs and "path=/" in attrs and "max-age=2592000" in attrs
        assert "samesite=lax" in attrs
        assert "secure" not in attrs
        me = c.get("/api/auth/me")
        assert me.status_code == 200
        assert me.json()["email"] == "ann@example.com"


def test_signed_out_me_is_401(make_client, clear_provider):
    with make_client(clear_provider, account=None) as c:
        r = c.get("/api/auth/me")
        assert r.status_code == 401
        assert r.json() == {"detail": "Sign in to continue."}


def test_invalid_email_at_signup(make_client, clear_provider):
    with make_client(clear_provider, account=None) as c:
        for bad in ("not-an-email", "a@b", "a b@example.com", "x" * 250 + "@example.com",
                    "x" * 5000 + "@example.com"):
            r = _signup(c, email=bad)
            assert r.status_code == 422, bad[:20]
            assert r.json() == {"detail": "Enter a valid email address."}
        for long in ("a" * 1025, "a" * 5000):
            r = _signup(c, password=long)
            assert r.status_code == 422
            assert r.json() == {"detail": "Use at most 1024 characters."}
        assert _signup(c).status_code == 201
        r = c.post("/api/auth/password", json={"current_password": TEST_PASSWORD, "new_password": "a" * 5000})
        assert r.status_code == 422
        assert r.json() == {"detail": "Use at most 1024 characters."}


def test_only_token_hash_is_stored(make_client, clear_provider):
    with make_client(clear_provider, account=None) as c:
        assert _signup(c).status_code == 201
        token = c.cookies.get(COOKIE)
        assert token
        with c.app.state.db.engine.connect() as conn:
            rows = conn.execute(text("SELECT * FROM user_sessions")).mappings().all()
        assert len(rows) == 1
        assert all(token not in str(v) for v in rows[0].values())
        assert rows[0]["token_hash"] == hashlib.sha256(token.encode()).hexdigest()


def test_existing_email_at_signup(make_client, clear_provider):
    with make_client(clear_provider, account=None) as c:
        assert _signup(c).status_code == 201
        for email in ("ann@example.com", "ANN@Example.com"):
            r = _signup(c, email=email)
            assert r.status_code == 409
            assert r.json() == {"detail": "An account with this email already exists. Sign in instead."}


def test_login_failures_read_the_same(make_client, clear_provider):
    with make_client(clear_provider, account=None) as c:
        assert _signup(c).status_code == 201
        unknown = _login(c, email="nobody@example.com")
        wrong = _login(c, password="not the right password")
        assert unknown.status_code == wrong.status_code == 401
        assert unknown.json() == wrong.json() == {"detail": SIGN_IN_FAILED}
        assert _login(c, email="  ANN@example.com").status_code == 200


def test_login_throttle(make_client, clear_provider):
    clock = FakeClock()
    with make_client(clear_provider, account=None, clock=clock) as c:
        assert _signup(c).status_code == 201
        for _ in range(5):
            assert _login(c, password="not the right password").status_code == 401
        r = _login(c)
        assert r.status_code == 429
        assert r.json() == {"detail": SIGN_IN_FAILED + " Try again in a few minutes."}

        for _ in range(5):
            assert _login(c, email="nobody@example.com").status_code == 401
        r = _login(c, email="nobody@example.com")
        assert r.status_code == 429
        assert r.json() == {"detail": SIGN_IN_FAILED + " Try again in a few minutes."}

        clock.advance(minutes=15)
        assert _login(c).status_code == 200


def test_successful_login_clears_the_count(make_client, clear_provider):
    with make_client(clear_provider, account=None, clock=FakeClock()) as c:
        assert _signup(c).status_code == 201
        for _ in range(4):
            assert _login(c, password="not the right password").status_code == 401
        assert _login(c).status_code == 200
        for _ in range(4):
            assert _login(c, password="not the right password").status_code == 401
        assert _login(c).status_code == 200


def test_signup_throttle_counts_failures_only(make_client, clear_provider):
    with make_client(clear_provider, account=None, clock=FakeClock()) as c:
        for i in range(6):
            assert _signup(c, email=f"user{i}@example.com").status_code == 201
        for _ in range(5):
            assert _signup(c, email="user0@example.com").status_code == 409
        r = _signup(c, email="fresh@example.com")
        assert r.status_code == 429
        assert r.json() == {"detail": "Too many attempts from here. Try again in a few minutes."}


def test_session_expiry_and_renewal(make_client, clear_provider):
    clock = FakeClock()
    with make_client(clear_provider, account=None, clock=clock) as c:
        assert _signup(c).status_code == 201
        quick = c.get("/api/auth/me")
        assert quick.status_code == 200
        assert "set-cookie" not in quick.headers  # renewed at most once an hour

        clock.advance(days=20)
        r = c.get("/api/auth/me")
        assert r.status_code == 200
        assert f"{COOKIE}=" in r.headers["set-cookie"]
        assert "max-age=2592000" in _cookie_attrs(r.headers["set-cookie"])
        with c.app.state.db.session() as s:
            row = s.scalar(select(UserSession))
            assert datetime.fromisoformat(row.expires_at) == START + timedelta(days=50)
            assert datetime.fromisoformat(row.last_seen_at) == START + timedelta(days=20)

        clock.advance(days=31)
        r = c.get("/api/auth/me")
        assert r.status_code == 401
        assert r.json() == {"detail": "Sign in to continue."}
        with c.app.state.db.session() as s:
            assert s.scalar(select(UserSession)) is None


def test_logout_revokes(make_client, clear_provider):
    with make_client(clear_provider, account=None) as c:
        assert _signup(c).status_code == 201
        token = c.cookies.get(COOKIE)
        r = c.post("/api/auth/logout")
        assert r.status_code == 204
        assert f"{COOKIE}=" in r.headers["set-cookie"]
        assert "max-age=0" in _cookie_attrs(r.headers["set-cookie"])
        c.cookies.clear()
        replay = c.get("/api/auth/me", headers={"Cookie": f"{COOKIE}={token}"})
        assert replay.status_code == 401
        with c.app.state.db.session() as s:
            assert s.scalar(select(UserSession)) is None
        assert c.post("/api/auth/logout").status_code == 204  # signed out: still 204


def test_change_password_revokes_other_sessions(make_app, clear_provider):
    app = make_app(clear_provider)
    with client_for(app, "ann@example.com") as a, client_for(app, "ann@example.com") as b:
        assert a.get("/api/auth/me").status_code == 200 and b.get("/api/auth/me").status_code == 200
        wrong = a.post("/api/auth/password", json={"current_password": "not the right password",
                                                   "new_password": NEW_PASSWORD})
        assert wrong.status_code == 400
        assert wrong.json() == {"detail": "That password isn’t right."}
        short = a.post("/api/auth/password", json={"current_password": TEST_PASSWORD, "new_password": "short"})
        assert short.status_code == 422
        assert short.json() == {"detail": "Use at least 12 characters."}

        r = a.post("/api/auth/password", json={"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD})
        assert r.status_code == 204
        assert a.get("/api/auth/me").status_code == 200
        assert b.get("/api/auth/me").status_code == 401
        assert _login(a).status_code == 401
        assert _login(a, password=NEW_PASSWORD).status_code == 200


def test_csrf_header_required(make_client, clear_provider):
    missing = {"detail": "Missing X-Requested-With header."}
    place = {"label": "Home", "latitude_deg": 40.0, "longitude_deg": -75.0, "timezone": "America/New_York"}
    with make_client(clear_provider, account=None, csrf=False) as c:
        r = _login(c)
        assert r.status_code == 403 and r.json() == missing
        r = c.post("/api/locations", json=place)
        assert r.status_code == 403 and r.json() == missing
        r = c.delete("/api/locations/sample-location")
        assert r.status_code == 403 and r.json() == missing
        r = c.post("/api/locations", json=place, headers={"X-Requested-With": "XMLHttpRequest"})
        assert r.status_code == 403 and r.json() == missing
        assert c.get("/api/locations").status_code == 200
        assert c.post("/api/locations", json=place, headers=CSRF_HEADERS).status_code == 201


def test_secrets_never_logged_or_echoed(make_client, clear_provider, caplog):
    caplog.set_level(logging.DEBUG)
    short = "tiny-pw-01"
    with make_client(clear_provider, account=None) as c:
        responses = [_signup(c)]
        token = c.cookies.get(COOKIE)
        responses += [_login(c), c.get("/api/auth/me"), _signup(c, email="bea@example.com", password=short)]
        responses.append(_login(c, password="x" * 2000))
    assert [r.status_code for r in responses] == [201, 200, 200, 422, 401]
    assert token
    for secret in (TEST_PASSWORD, short, token):
        assert secret not in caplog.text
        for r in responses:
            assert secret not in r.text
    assert "x" * 100 not in responses[-1].text


def test_reset_password_cli(make_app, clear_provider):
    app = make_app(clear_provider)
    with client_for(app, None) as c:
        assert _signup(c, email="Ann@example.com").status_code == 201
        assert c.get("/api/auth/me").status_code == 200

        asked: list[str] = []

        def prompt(p):
            asked.append(p)
            return NEW_PASSWORD

        lines: list[str] = []
        assert accounts_cli(["reset-password", "Ann@example.com"], db=app.state.db, prompt=prompt,
                            out=lines.append) == 0
        assert asked == ["New password: ", "Repeat it: "]
        assert lines == ["Password changed for ann@example.com. Every device was signed out."]
        assert c.get("/api/auth/me").status_code == 401
        assert _login(c).status_code == 401
        assert _login(c, password=NEW_PASSWORD).status_code == 200

        answers = iter([NEW_PASSWORD, "something else entirely"])
        lines.clear()
        assert accounts_cli(["reset-password", "ann@example.com"], db=app.state.db,
                            prompt=lambda p: next(answers), out=lines.append) == 1
        assert lines == ["Passwords don’t match."]

        lines.clear()
        assert accounts_cli(["reset-password", "ann@example.com"], db=app.state.db,
                            prompt=lambda p: "short", out=lines.append) == 1
        assert lines == ["Use at least 12 characters."]

        lines.clear()
        assert accounts_cli(["reset-password", "nobody@example.com"], db=app.state.db, prompt=prompt,
                            out=lines.append) == 1
        assert lines == ["No account with that email."]
        assert _login(c, password=NEW_PASSWORD).status_code == 200
