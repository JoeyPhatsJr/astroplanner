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


def _head_revision() -> str:
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from app.db import BACKEND_DIR
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    return ScriptDirectory.from_config(cfg).get_current_head()


def test_migrated_schema_matches_orm_metadata(tmp_path):
    from app.db import Base
    db = Database(f"sqlite:///{tmp_path / 'm.db'}")
    db.init()
    insp = sqlalchemy.inspect(db.engine)
    existing = set(insp.get_table_names())
    for name, table in Base.metadata.tables.items():
        assert name in existing, f"missing table {name}"
        assert {c["name"] for c in insp.get_columns(name)} == {c.name for c in table.columns}, name


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
        c.execute(text(
            "INSERT INTO sessions (id,title,location_id,local_night_date,status,created_at,updated_at) "
            "VALUES ('s1','Plan','x','2026-11-02','planned','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')"))
        c.execute(text("INSERT INTO session_targets (id,session_id,target_id,sort_order) VALUES ('t1','s1','m31',0)"))
    eng.dispose()
    Database(url).init()
    with create_engine(url).connect() as c:
        assert c.execute(text("SELECT label FROM observing_locations WHERE id='x'")).scalar() == "Home"
        assert c.execute(text("SELECT version_num FROM alembic_version")).scalar() == _head_revision()
        row = c.execute(text("SELECT title, location_id, source FROM sessions WHERE id='s1'")).one()
        assert tuple(row) == ("Plan", "x", "planned")
        st = c.execute(text("SELECT session_id, target_id, library_target_id FROM session_targets WHERE id='t1'")).one()
        assert tuple(st) == ("s1", "m31", None)


def test_downgrade_to_baseline_keeps_phase1_data(tmp_path):
    from alembic import command
    from alembic.config import Config
    from app.db import BACKEND_DIR
    url = f"sqlite:///{tmp_path / 'd.db'}"
    run_migrations(url)
    eng = create_engine(url)
    with eng.begin() as c:
        c.execute(text("INSERT INTO sessions (id,title,local_night_date,status,created_at,updated_at) "
                       "VALUES ('s1','T','2026-11-02','planned','x','x')"))
        c.execute(text("INSERT INTO session_targets (id,session_id,target_id,sort_order) VALUES ('t1','s1','M31',0)"))
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.downgrade(cfg, "0001_phase1_baseline")
    insp = sqlalchemy.inspect(eng)
    assert "library_targets" not in insp.get_table_names()
    assert "source" not in {c["name"] for c in insp.get_columns("sessions")}
    with eng.connect() as c:
        assert c.execute(text("SELECT title FROM sessions WHERE id='s1'")).scalar() == "T"
        assert c.execute(text("SELECT target_id FROM session_targets WHERE id='t1'")).scalar() == "M31"
    eng.dispose()


def test_run_migrations_is_idempotent(tmp_path):
    url = f"sqlite:///{tmp_path / 'b.db'}"
    run_migrations(url)
    run_migrations(url)


def _is_disposable_postgres(url: str) -> bool:
    u = sqlalchemy.engine.make_url(url)
    return "test" in (u.database or "").lower() or (u.host or "") in ("localhost", "127.0.0.1", "::1")


def test_postgres_guard_refuses_non_test_databases():
    assert _is_disposable_postgres("postgresql://u:p@localhost/astro")
    assert _is_disposable_postgres("postgresql://u:p@db.example.com/astro_test")
    assert not _is_disposable_postgres("postgresql://u:p@db.example.com/astroplanner")


# GUARD: this test DROPS the whole `public` schema of TEST_POSTGRES_URL. Point it only at a throwaway
# database; it refuses to run unless the database name contains "test" or the host is localhost.
@pytest.mark.skipif(not os.environ.get("TEST_POSTGRES_URL"), reason="TEST_POSTGRES_URL not set")
def test_migrations_on_postgres():
    url = os.environ["TEST_POSTGRES_URL"]
    if not _is_disposable_postgres(url):
        pytest.fail("Refusing to drop the schema: TEST_POSTGRES_URL must name a *test* database or localhost.")
    eng = create_engine(url)
    with eng.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE"))
        c.execute(text("CREATE SCHEMA public"))
    run_migrations(url)
    assert PHASE1_TABLES | {"alembic_version"} <= set(sqlalchemy.inspect(eng).get_table_names())
    run_migrations(url)  # idempotent
    eng.dispose()


def test_0003_adds_and_drops_library_target_coords(tmp_path):
    from alembic import command
    from alembic.config import Config
    from app.db import BACKEND_DIR
    url = f"sqlite:///{tmp_path / 'c.db'}"
    run_migrations(url)
    eng = create_engine(url)
    cols = {c["name"] for c in sqlalchemy.inspect(eng).get_columns("library_targets")}
    assert {"ra_deg", "dec_deg"} <= cols
    with eng.begin() as c:
        c.execute(text("INSERT INTO library_targets (id,normalized_key,kind,created_at,ra_deg,dec_deg) "
                       "VALUES ('l1','custom:x','custom','x',1.5,2.5)"))
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.downgrade(cfg, "0002_astrolog")
    cols = {c["name"] for c in sqlalchemy.inspect(eng).get_columns("library_targets")}
    assert "ra_deg" not in cols and "dec_deg" not in cols
    with eng.connect() as c:
        assert c.execute(text("SELECT normalized_key FROM library_targets WHERE id='l1'")).scalar() == "custom:x"
    eng.dispose()


def test_0004_adds_and_drops_exif_columns(tmp_path):
    from alembic import command
    from alembic.config import Config
    from app.db import BACKEND_DIR
    url = f"sqlite:///{tmp_path / 'e.db'}"
    run_migrations(url)
    eng = create_engine(url)
    insp = sqlalchemy.inspect(eng)
    assert {"iso", "f_number", "focal_mm"} <= {c["name"] for c in insp.get_columns("capture_frames")}
    assert "lens" in {c["name"] for c in insp.get_columns("capture_sets")}
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.downgrade(cfg, "0003_library_target_coords")
    insp = sqlalchemy.inspect(eng)
    assert not {"iso", "f_number", "focal_mm"} & {c["name"] for c in insp.get_columns("capture_frames")}
    assert "lens" not in {c["name"] for c in insp.get_columns("capture_sets")}
    command.upgrade(cfg, "head")
    eng.dispose()


def test_0006_adds_and_drops_account_tables(tmp_path):
    from alembic import command
    from alembic.config import Config
    from app.db import BACKEND_DIR
    url = f"sqlite:///{tmp_path / 'f.db'}"
    run_migrations(url)
    eng = create_engine(url)
    insp = sqlalchemy.inspect(eng)
    assert {"users", "user_sessions"} <= set(insp.get_table_names())
    assert "ix_user_sessions_user_id" in {i["name"] for i in insp.get_indexes("user_sessions")}
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.downgrade(cfg, "0005_processing_runs")
    assert not {"users", "user_sessions"} & set(sqlalchemy.inspect(eng).get_table_names())
    command.upgrade(cfg, "head")
    eng.dispose()

