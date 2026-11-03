"""Phase 1 baseline: locations, equipment, sessions, session targets.

Revision ID: 0001_phase1_baseline
Revises:
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_phase1_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "observing_locations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("label", sa.String(120), nullable=False),
        sa.Column("latitude_deg", sa.Float(), nullable=False),
        sa.Column("longitude_deg", sa.Float(), nullable=False),
        sa.Column("elevation_m", sa.Float(), nullable=True),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("is_sample", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_table(
        "equipment_profiles",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("manufacturer", sa.String(120), nullable=True),
        sa.Column("aperture_mm", sa.Float(), nullable=True),
        sa.Column("focal_length_mm", sa.Float(), nullable=True),
        sa.Column("fov_deg", sa.Float(), nullable=True),
        sa.Column("fov_definition", sa.String(16), nullable=False),
        sa.Column("wide_fov_deg", sa.Float(), nullable=True),
        sa.Column("sensor", sa.String(120), nullable=True),
        sa.Column("mount_type", sa.String(120), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_verified", sa.Boolean(), nullable=False),
        sa.Column("is_preset", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_table(
        "sessions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("location_id", sa.String(), sa.ForeignKey("observing_locations.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("equipment_id", sa.String(), sa.ForeignKey("equipment_profiles.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("local_night_date", sa.String(10), nullable=False),
        sa.Column("start_utc", sa.String(), nullable=True),
        sa.Column("end_utc", sa.String(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
    )
    op.create_table(
        "session_targets",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("session_id", sa.String(), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_id", sa.String(32), nullable=False),
        sa.Column("planned_start_utc", sa.String(), nullable=True),
        sa.Column("planned_end_utc", sa.String(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("actual_integration_seconds", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("session_targets")
    op.drop_table("sessions")
    op.drop_table("equipment_profiles")
    op.drop_table("observing_locations")
