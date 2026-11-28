"""Accounts: an owner on saved places and custom equipment.

Adds a nullable ``owner_id`` (FK ``users.id`` RESTRICT, ``fk_<table>_owner``, index ``ix_<table>_owner_id``) to
observing_locations and equipment_profiles, as 0007_ownership did for plans and AstroLog. Sample places
(``is_sample``) and preset equipment (``is_preset``) stay ownerless: they are shared and read-only.

Data step, for rows that are neither sample nor preset and have no owner: if the first-account claim already ran
(``AppMeta("accounts_claimed")`` holds that user's id) and that user still exists, they get the rows, as they got
every plan and night in 0007. Otherwise the rows stay ownerless and ``app.accounts.owned.claim_unowned`` hands them
to the first account created. Until then no one sees them: the API shows a row only to its owner, or to everyone
when it is a sample or preset.

On SQLite both tables are rebuilt by batch mode; ``run_migrations`` turns foreign keys off for the upgrade so
dropping a table that sessions or capture sets reference fires no ON DELETE action. Plain SQLAlchemy operations
otherwise, so this runs on SQLite and Postgres.

``downgrade()`` drops the owners. The places and equipment are then visible to everyone again, as before.

Revision ID: 0008_private_places
Revises: 0007_ownership
"""
from alembic import op
import sqlalchemy as sa

revision = "0008_private_places"
down_revision = "0007_ownership"
branch_labels = None
depends_on = None

# table -> the flag that marks its shared, read-only rows
OWNED_TABLES = {"observing_locations": "is_sample", "equipment_profiles": "is_preset"}
CLAIM_KEY = "accounts_claimed"


def upgrade() -> None:
    for table in OWNED_TABLES:
        with op.batch_alter_table(table) as b:
            b.add_column(sa.Column("owner_id", sa.String(), nullable=True))
            b.create_foreign_key(f"fk_{table}_owner", "users", ["owner_id"], ["id"], ondelete="RESTRICT")
            b.create_index(f"ix_{table}_owner_id", ["owner_id"])

    conn = op.get_bind()
    app_meta = sa.table("app_meta", sa.column("key", sa.String), sa.column("value", sa.Text))
    users = sa.table("users", sa.column("id", sa.String))
    claimer = conn.execute(sa.select(app_meta.c.value).where(app_meta.c.key == CLAIM_KEY)).scalar()
    if claimer is None or conn.execute(sa.select(users.c.id).where(users.c.id == claimer)).first() is None:
        return  # no claim yet (the first sign-up takes them), or its user is gone (they stay ownerless)
    for table, shared_flag in OWNED_TABLES.items():
        t = sa.table(table, sa.column("owner_id", sa.String), sa.column(shared_flag, sa.Boolean))
        conn.execute(t.update().where(t.c.owner_id.is_(None), t.c[shared_flag] == sa.false())
                     .values(owner_id=claimer))


def downgrade() -> None:
    for table in reversed(list(OWNED_TABLES)):
        with op.batch_alter_table(table) as b:
            b.drop_index(f"ix_{table}_owner_id")
            b.drop_constraint(f"fk_{table}_owner", type_="foreignkey")
            b.drop_column("owner_id")
