from __future__ import annotations

import os

import pytest
import sqlalchemy
from sqlalchemy import create_engine, text

from app.db import Database, run_migrations

PHASE1_TABLES = {"observing_locations", "equipment_profiles", "sessions", "session_targets"}

# Explicit Phase 1 schema (deliberately NOT Base.metadata.create_all, which will grow Phase 2 tables).
PHASE1_DDL = [
    """CREATE TABLE observing_locations (
        id VARCHAR NOT NULL PRIMARY KEY, label VARCHAR(120) NOT NULL,
        latitude_deg FLOAT NOT NULL, longitude_deg FLOAT NOT NULL, elevation_m FLOAT,
        timezone VARCHAR(64) NOT NULL, is_sample BOOLEAN NOT NULL, created_at VARCHAR NOT NULL)""",
    """CREATE TABLE equipment_profiles (
        id VARCHAR NOT NULL PRIMARY KEY, name VARCHAR(120) NOT NULL, manufacturer VARCHAR(120),
        aperture_mm FLOAT, focal_length_mm FLOAT, fov_deg FLOAT, fov_definition VARCHAR(16) NOT NULL,
        wide_fov_deg FLOAT, sensor VARCHAR(120), mount_type VARCHAR(120), source_url TEXT, notes TEXT,
        is_verified BOOLEAN NOT NULL, is_preset BOOLEAN NOT NULL, created_at VARCHAR NOT NULL)""",
    """CREATE TABLE sessions (
        id VARCHAR NOT NULL PRIMARY KEY, title VARCHAR(160) NOT NULL,
        location_id VARCHAR REFERENCES observing_locations(id) ON DELETE RESTRICT,
        equipment_id VARCHAR REFERENCES equipment_profiles(id) ON DELETE RESTRICT,
        local_night_date VARCHAR(10) NOT NULL, start_utc VARCHAR, end_utc VARCHAR,
        status VARCHAR(16) NOT NULL, notes TEXT, created_at VARCHAR NOT NULL, updated_at VARCHAR NOT NULL)""",
    """CREATE TABLE session_targets (
        id VARCHAR NOT NULL PRIMARY KEY,
        session_id VARCHAR NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        target_id VARCHAR(32) NOT NULL, planned_start_utc VARCHAR, planned_end_utc VARCHAR,
        sort_order INTEGER NOT NULL, actual_integration_seconds INTEGER, notes TEXT)""",
]


def test_fresh_database_builds_from_migrations(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'a.db'}")
    db.init()
    insp = sqlalchemy.inspect(db.engine)
    assert PHASE1_TABLES | {"alembic_version"} <= set(insp.get_table_names())


def test_existing_phase1_database_is_stamped_and_keeps_data(tmp_path):
    url = f"sqlite:///{tmp_path / 'old.db'}"
    eng = create_engine(url)
    with eng.begin() as c:
        for ddl in PHASE1_DDL:
            c.execute(text(ddl))
        c.execute(text(
            "INSERT INTO observing_locations (id,label,latitude_deg,longitude_deg,timezone,is_sample,created_at) "
            "VALUES ('x','Home',1,2,'UTC',0,'2026-01-01T00:00:00Z')"))
    eng.dispose()
    Database(url).init()
    with create_engine(url).connect() as c:
        assert c.execute(text("SELECT label FROM observing_locations WHERE id='x'")).scalar() == "Home"
        assert c.execute(text("SELECT version_num FROM alembic_version")).scalar() is not None


def test_run_migrations_is_idempotent(tmp_path):
    url = f"sqlite:///{tmp_path / 'b.db'}"
    run_migrations(url)
    run_migrations(url)


@pytest.mark.skipif(not os.environ.get("TEST_POSTGRES_URL"), reason="TEST_POSTGRES_URL not set")
def test_migrations_on_postgres():
    url = os.environ["TEST_POSTGRES_URL"]
    eng = create_engine(url)
    with eng.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE"))
        c.execute(text("CREATE SCHEMA public"))
    run_migrations(url)
    assert PHASE1_TABLES | {"alembic_version"} <= set(sqlalchemy.inspect(eng).get_table_names())
    run_migrations(url)  # idempotent
    eng.dispose()
