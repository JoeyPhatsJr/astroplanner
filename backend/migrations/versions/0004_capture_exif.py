"""Canon EXIF on captures: per-frame ISO / f-number / focal length and the capture set's lens.

All nullable: FITS frames (and frames imported before this revision) leave them null, which the
UI shows as unknown. Nothing is back-filled or estimated.

Revision ID: 0004_capture_exif
Revises: 0003_library_target_coords
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_capture_exif"
down_revision = "0003_library_target_coords"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("capture_frames") as b:
        b.add_column(sa.Column("iso", sa.Integer(), nullable=True))
        b.add_column(sa.Column("f_number", sa.Float(), nullable=True))
        b.add_column(sa.Column("focal_mm", sa.Float(), nullable=True))
    with op.batch_alter_table("capture_sets") as b:
        b.add_column(sa.Column("lens", sa.String(length=120), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("capture_sets") as b:
        b.drop_column("lens")
    with op.batch_alter_table("capture_frames") as b:
        b.drop_column("focal_mm")
        b.drop_column("f_number")
        b.drop_column("iso")
