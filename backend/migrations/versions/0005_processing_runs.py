"""Processing Coach: the runs table, and the Bayer pattern read from each FITS frame header.

`capture_frames.bayer_pattern` is nullable: Canon frames and frames imported before this revision
leave it null (nothing is back-filled). One run per capture set (unique), RESTRICT so a capture set
with a run cannot be deleted from under it. Plain SQLAlchemy types only, so it runs on SQLite and Postgres.

Revision ID: 0005_processing_runs
Revises: 0004_capture_exif
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_processing_runs"
down_revision = "0004_capture_exif"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("capture_frames") as b:
        b.add_column(sa.Column("bayer_pattern", sa.String(length=8), nullable=True))
    op.create_table(
        "processing_runs",
        sa.Column("id", sa.String(), primary_key=True, nullable=False),
        sa.Column("capture_set_id", sa.String(), sa.ForeignKey("capture_sets.id", ondelete="RESTRICT"),
                  nullable=False, unique=True),
        sa.Column("siril_version", sa.String(length=32), nullable=True),
        sa.Column("step_states", sa.JSON(), nullable=False),
        sa.Column("choices", sa.JSON(), nullable=False),
        sa.Column("folder", sa.JSON(), nullable=True),
        sa.Column("frame_stats", sa.JSON(), nullable=True),
        sa.Column("comparison", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("processing_runs")
    with op.batch_alter_table("capture_frames") as b:
        b.drop_column("bayer_pattern")
