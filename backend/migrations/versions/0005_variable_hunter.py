"""Phase 3 Variable Hunter: cached AAVSO observations, fetch log, alert dismissals.

Observations keep only JD, magnitude, uncertainty, band, fainterThan, obsType, validation flag and
a salted hash of the observer code (never names, countries, comments or chart IDs). The salt lives
in ``app_meta`` (key ``aavso_observer_salt``) and is created by the app, not by this migration.

Revision ID: 0005_variable_hunter
Revises: 0004_capture_exif
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_variable_hunter"
down_revision = "0004_capture_exif"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "variable_observations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("star_id", sa.String(32), nullable=False),
        sa.Column("obs_id", sa.String(40), nullable=False),
        sa.Column("jd", sa.Float(), nullable=False),
        sa.Column("mag", sa.Float(), nullable=False),
        sa.Column("uncert", sa.Float(), nullable=True),
        sa.Column("band", sa.String(16), nullable=False),
        sa.Column("fainter_than", sa.Boolean(), nullable=False),
        sa.Column("obs_type", sa.String(16), nullable=False),
        sa.Column("val", sa.String(4), nullable=False),
        sa.Column("observer_hash", sa.String(16), nullable=False),
        sa.UniqueConstraint("star_id", "obs_id", name="uq_variable_observation"),
    )
    op.create_index("ix_variable_observations_star_id", "variable_observations", ["star_id"])
    op.create_index("ix_variable_observations_jd", "variable_observations", ["jd"])
    op.create_table(
        "variable_fetches",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("star_id", sa.String(32), nullable=False),
        sa.Column("path", sa.String(8), nullable=False),
        sa.Column("from_jd", sa.Float(), nullable=False),
        sa.Column("to_jd", sa.Float(), nullable=False),
        sa.Column("started_at", sa.String(), nullable=False),
        sa.Column("finished_at", sa.String(), nullable=True),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.Column("rows", sa.Integer(), nullable=False),
        sa.Column("error", sa.String(200), nullable=True),
    )
    op.create_index("ix_variable_fetches_star_id", "variable_fetches", ["star_id"])
    op.create_table(
        "variable_alert_dismissals",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("star_id", sa.String(32), nullable=False, unique=True),
        sa.Column("dismissed_at", sa.String(), nullable=False),
        sa.Column("alert_since_jd", sa.Float(), nullable=False),
    )


def downgrade() -> None:
    for t in ("variable_alert_dismissals", "variable_fetches", "variable_observations"):
        op.drop_table(t)
