"""Accounts: the users table and their sign-in sessions.

Only a SHA-256 hash of each session token is stored. ``user_sessions.user_id`` is RESTRICT, so a user is
deleted only after their sessions (account deletion does this in code). Plain SQLAlchemy types only, so it
runs on SQLite and Postgres. Existing rows are untouched.

Revision ID: 0006_accounts
Revises: 0005_processing_runs
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_accounts"
down_revision = "0005_processing_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(), primary_key=True, nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("claimed_existing", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.String(), primary_key=True, nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False, unique=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("last_seen_at", sa.String(), nullable=False),
        sa.Column("expires_at", sa.String(), nullable=False),
    )
    op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_user_sessions_user_id", table_name="user_sessions")
    op.drop_table("user_sessions")
    op.drop_table("users")
