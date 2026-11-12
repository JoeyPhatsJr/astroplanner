"""Account tables: users and their sign-in sessions (migration 0006_accounts).

Kept apart from the CLI so ``python -m app.accounts`` never defines a table twice. Times are ISO UTC strings
("2026-11-11T20:00:00Z"), as elsewhere in the schema. Only a SHA-256 hash of a session token is stored.
"""

from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, String, false
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, _utcnow, _uuid


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, default=_utcnow)
    claimed_existing: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())


class UserSession(Base):
    __tablename__ = "user_sessions"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[str] = mapped_column(String)
    last_seen_at: Mapped[str] = mapped_column(String)
    expires_at: Mapped[str] = mapped_column(String)
