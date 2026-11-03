"""Library targets: object RA/Dec from headers as provenance for custom targets (spec §7).

These are the OBJECT's sky coordinates (FITS RA/DEC), never the observing site (SITELAT/SITELONG).

Revision ID: 0003_library_target_coords
Revises: 0002_astrolog
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_library_target_coords"
down_revision = "0002_astrolog"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("library_targets") as b:
        b.add_column(sa.Column("ra_deg", sa.Float(), nullable=True))
        b.add_column(sa.Column("dec_deg", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("library_targets") as b:
        b.drop_column("dec_deg")
        b.drop_column("ra_deg")
