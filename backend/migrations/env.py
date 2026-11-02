"""Alembic environment. The URL / connection comes from the passed config, never a global."""

from __future__ import annotations

from alembic import context
from sqlalchemy import create_engine

config = context.config


def _run(connection) -> None:
    context.configure(connection=connection, target_metadata=None)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        _run(connection)
        return
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    try:
        with engine.connect() as conn:
            _run(conn)
    finally:
        engine.dispose()


run_migrations_online()
