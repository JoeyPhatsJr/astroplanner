"""Account rules, password hashing (Argon2id) and server-side sign-in sessions.

The session helpers change rows and flush; the caller commits, so a route can do several steps in one
transaction. The browser holds a random token; only ``sha256(token)`` is stored.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error, InvalidHashError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .models import User, UserSession

MIN_PASSWORD, MAX_PASSWORD = 12, 1024
MAX_EMAIL = 254
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
SESSION_LIFETIME = timedelta(days=30)
RENEW_AFTER = timedelta(hours=1)  # renew (and re-send the cookie) at most once an hour of use

_hasher = PasswordHasher()  # library defaults: Argon2id


class AccountInputError(ValueError):
    """An email or password that breaks the account rules; ``message`` is user-facing copy."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def normalize_email(raw: str) -> str:
    email = raw.strip().lower()
    if len(email) > MAX_EMAIL or not EMAIL_RE.match(email):
        raise AccountInputError("Enter a valid email address.")
    return email


def check_password(pw: str) -> None:
    if len(pw) < MIN_PASSWORD:
        raise AccountInputError("Use at least 12 characters.")
    if len(pw) > MAX_PASSWORD:
        raise AccountInputError("Use at most 1024 characters.")


def hash_password(pw: str) -> str:
    return _hasher.hash(pw)


def verify_password(hash: str, pw: str) -> bool:
    """True only for a matching password; never raises (a malformed hash is just False)."""
    try:
        return _hasher.verify(hash, pw)
    except (Argon2Error, InvalidHashError, ValueError, TypeError):
        return False


# Verified against when the email is unknown, so an unknown email costs the same time as a wrong password.
DUMMY_HASH = hash_password(secrets.token_urlsafe(32))


def iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db: Session, user: User, now: datetime) -> str:
    """Add a session row for ``user`` and return the raw token (it is never stored)."""
    token = secrets.token_urlsafe(32)
    db.add(UserSession(user_id=user.id, token_hash=token_hash(token), created_at=iso_utc(now),
                       last_seen_at=iso_utc(now), expires_at=iso_utc(now + SESSION_LIFETIME)))
    db.flush()
    return token


def resolve_session(db: Session, token: str | None, now: datetime) -> tuple[User, bool] | None:
    """The user a token signs in, and whether the session was renewed; None if unknown or expired.

    An expired row is deleted. A session last seen more than an hour ago is renewed for 30 days from now.
    """
    if not token:
        return None
    row = db.scalar(select(UserSession).where(UserSession.token_hash == token_hash(token)))
    if row is None:
        return None
    if _parse(row.expires_at) <= now:
        db.delete(row)
        db.flush()
        return None
    renewed = now - _parse(row.last_seen_at) > RENEW_AFTER
    if renewed:
        row.last_seen_at = iso_utc(now)
        row.expires_at = iso_utc(now + SESSION_LIFETIME)
        db.flush()
    user = db.get(User, row.user_id)
    if user is None:
        return None
    return user, renewed


def revoke_session(db: Session, token: str | None) -> None:
    if token:
        db.execute(delete(UserSession).where(UserSession.token_hash == token_hash(token)))


def revoke_other_sessions(db: Session, user_id: str, keep_token: str | None) -> None:
    q = delete(UserSession).where(UserSession.user_id == user_id)
    if keep_token:
        q = q.where(UserSession.token_hash != token_hash(keep_token))
    db.execute(q)


def revoke_all_sessions(db: Session, user_id: str) -> None:
    db.execute(delete(UserSession).where(UserSession.user_id == user_id))
