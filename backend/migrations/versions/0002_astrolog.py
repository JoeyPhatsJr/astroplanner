"""Phase 2 Astrolog: library targets, capture sets/frames, stacks, final images, app_meta.

Revision ID: 0002_astrolog
Revises: 0001_phase1_baseline
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_astrolog"
down_revision = "0001_phase1_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_meta",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", sa.Text(), nullable=True),
    )
    op.create_table(
        "library_targets",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("catalog_target_id", sa.String(32), nullable=True),
        sa.Column("custom_name", sa.String(160), nullable=True),
        sa.Column("normalized_key", sa.String(200), nullable=False, unique=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_table(
        "capture_sets",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("session_id", sa.String(), sa.ForeignKey("sessions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("library_target_id", sa.String(), sa.ForeignKey("library_targets.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("device", sa.String(64), nullable=False),
        sa.Column("equipment_id", sa.String(), sa.ForeignKey("equipment_profiles.id", ondelete="SET NULL"), nullable=True),
        sa.Column("equipment_snapshot", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.UniqueConstraint("session_id", "library_target_id", "device", name="uq_capture_set"),
    )
    op.create_table(
        "capture_frames",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("capture_set_id", sa.String(), sa.ForeignKey("capture_sets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date_obs_utc", sa.String(), nullable=False),
        sa.Column("exptime_s", sa.Float(), nullable=False),
        sa.Column("filter", sa.String(64), nullable=True),
        sa.Column("gain", sa.Float(), nullable=True),
        sa.Column("ccd_temp_c", sa.Float(), nullable=True),
        sa.Column("source_filename", sa.String(512), nullable=False),
        sa.Column("dedup_key", sa.String(200), nullable=False, unique=True),
        sa.Column("imported_at", sa.String(), nullable=False),
    )
    op.create_table(
        "stacks",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("library_target_id", sa.String(), sa.ForeignKey("library_targets.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("session_id", sa.String(), sa.ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source_filename", sa.String(512), nullable=False),
        sa.Column("stack_count", sa.Integer(), nullable=True),
        sa.Column("livetime_s", sa.Float(), nullable=True),
        sa.Column("exptime_s", sa.Float(), nullable=True),
        sa.Column("expstart_jd", sa.Float(), nullable=True),
        sa.Column("expend_jd", sa.Float(), nullable=True),
        sa.Column("program", sa.String(120), nullable=True),
        sa.Column("provenance", sa.String(16), nullable=False),
        sa.Column("dedup_key", sa.String(200), nullable=False, unique=True),
        sa.Column("imported_at", sa.String(), nullable=False),
    )
    op.create_table(
        "final_images",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("library_target_id", sa.String(), sa.ForeignKey("library_targets.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("stack_id", sa.String(), sa.ForeignKey("stacks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source_filename", sa.String(512), nullable=False),
        sa.Column("format", sa.String(16), nullable=False),
        sa.Column("preview_key", sa.String(512), nullable=False),
        sa.Column("thumb_key", sa.String(512), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column("chosen_at", sa.String(), nullable=False),
    )
    op.create_index("ix_capture_sets_session_id", "capture_sets", ["session_id"])
    op.create_index("ix_capture_frames_capture_set_id", "capture_frames", ["capture_set_id"])
    op.create_index("ix_stacks_library_target_id", "stacks", ["library_target_id"])
    op.create_index("ix_final_images_library_target_id", "final_images", ["library_target_id"])
    op.create_index("ix_final_images_stack_id", "final_images", ["stack_id"])
    with op.batch_alter_table("session_targets") as b:
        b.add_column(sa.Column("library_target_id", sa.String(), nullable=True))
        b.create_foreign_key(
            "fk_session_targets_library_target", "library_targets", ["library_target_id"], ["id"],
            ondelete="SET NULL",
        )
    with op.batch_alter_table("sessions") as b:
        b.add_column(sa.Column("source", sa.String(16), nullable=False, server_default="planned"))


def downgrade() -> None:
    # Children first; the sessions batch rebuild runs last, once nothing references sessions.
    with op.batch_alter_table("session_targets") as b:
        b.drop_constraint("fk_session_targets_library_target", type_="foreignkey")
        b.drop_column("library_target_id")
    for t in ("final_images", "stacks", "capture_frames", "capture_sets", "library_targets", "app_meta"):
        op.drop_table(t)
    with op.batch_alter_table("sessions") as b:
        b.drop_column("source")
