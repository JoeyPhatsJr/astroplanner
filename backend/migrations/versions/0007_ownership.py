"""Accounts: an owner on every plan, night and AstroLog / coach row, and per-owner unique keys.

Adds a nullable ``owner_id`` (FK ``users.id`` RESTRICT, ``fk_<table>_owner``, index ``ix_<table>_owner_id``) to
sessions, library_targets, capture_sets, capture_frames, stacks, final_images and processing_runs. Existing rows
keep a NULL owner until the first account claims them (``app.accounts.owned.claim_unowned``). The three global
uniques (library target ``normalized_key``, frame and stack ``dedup_key``) become ``(owner_id, <column>)``.

On SQLite every table here is rebuilt by batch mode (copy, drop, rename). ``run_migrations`` turns foreign keys
off for the upgrade so dropping ``library_targets`` or ``stacks`` fires no ON DELETE action on their children,
and runs ``PRAGMA foreign_key_check`` before committing. Plain SQLAlchemy operations otherwise, so this runs on
SQLite and Postgres.

The old uniques were unnamed column-level constraints. SQLite batch mode names them through a naming convention
(``uq_<table>_<column>``); Postgres gave them a default name, which is read back from the database.

``downgrade()`` restores the global uniques, so it fails if two owners hold the same library key or the same
frame or stack dedup key. It also drops every owner but leaves ``AppMeta("accounts_claimed")`` in place, so after
a later upgrade those rows stay ownerless: no further sign-up claims them.

Revision ID: 0007_ownership
Revises: 0006_accounts
"""
from alembic import op
import sqlalchemy as sa

revision = "0007_ownership"
down_revision = "0006_accounts"
branch_labels = None
depends_on = None

OWNED_TABLES = ("sessions", "library_targets", "capture_sets", "capture_frames", "stacks", "final_images",
                "processing_runs")
# table -> (column that was globally unique, the new per-owner constraint)
PER_OWNER_UNIQUES = {
    "library_targets": ("normalized_key", "uq_library_targets_owner_key"),
    "capture_frames": ("dedup_key", "uq_capture_frames_owner_dedup"),
    "stacks": ("dedup_key", "uq_stacks_owner_dedup"),
}
SQLITE_UQ_NAMING = {"uq": "uq_%(table_name)s_%(column_0_name)s"}


def _is_sqlite() -> bool:
    return op.get_bind().dialect.name == "sqlite"


def _global_unique_name(table: str, column: str) -> str:
    """The name of the single-column unique on ``table.column`` as this database knows it."""
    if _is_sqlite():
        return f"uq_{table}_{column}"  # given to the unnamed constraint by SQLITE_UQ_NAMING
    for uc in sa.inspect(op.get_bind()).get_unique_constraints(table):
        if list(uc["column_names"]) == [column]:
            return uc["name"]
    raise RuntimeError(f"No unique constraint on {table}.{column} to replace.")


def _batch(table: str):
    if table in PER_OWNER_UNIQUES and _is_sqlite():
        return op.batch_alter_table(table, naming_convention=SQLITE_UQ_NAMING)
    return op.batch_alter_table(table)


def upgrade() -> None:
    for table in OWNED_TABLES:
        old_unique = None
        if table in PER_OWNER_UNIQUES:
            column, _ = PER_OWNER_UNIQUES[table]
            old_unique = _global_unique_name(table, column)
        with _batch(table) as b:
            b.add_column(sa.Column("owner_id", sa.String(), nullable=True))
            b.create_foreign_key(f"fk_{table}_owner", "users", ["owner_id"], ["id"], ondelete="RESTRICT")
            b.create_index(f"ix_{table}_owner_id", ["owner_id"])
            if old_unique is not None:
                column, new_name = PER_OWNER_UNIQUES[table]
                b.drop_constraint(old_unique, type_="unique")
                b.create_unique_constraint(new_name, ["owner_id", column])


def downgrade() -> None:
    # Restoring the global uniques fails if two owners hold the same key: nothing is merged or deleted here.
    for table in reversed(OWNED_TABLES):
        with op.batch_alter_table(table) as b:
            if table in PER_OWNER_UNIQUES:
                column, new_name = PER_OWNER_UNIQUES[table]
                b.drop_constraint(new_name, type_="unique")
                b.create_unique_constraint(f"uq_{table}_{column}", [column])
            b.drop_index(f"ix_{table}_owner_id")
            b.drop_constraint(f"fk_{table}_owner", type_="foreignkey")
            b.drop_column("owner_id")
