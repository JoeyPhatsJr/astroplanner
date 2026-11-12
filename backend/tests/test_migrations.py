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


# --- 0007_ownership -------------------------------------------------------------------------------------

OWNED_TABLES = ("sessions", "library_targets", "capture_sets", "capture_frames", "stacks", "final_images",
                "processing_runs")
SEEDED_TABLES = ("observing_locations", "sessions", "session_targets", "library_targets", "capture_sets",
                 "capture_frames", "stacks", "final_images", "processing_runs")

# Every row of every table, linked, written with raw SQL at 0006_accounts (before owners exist).
SEED_0006 = [
    "INSERT INTO observing_locations (id,label,latitude_deg,longitude_deg,timezone,is_sample,created_at) "
    "VALUES ('loc1','Home',40,-75,'America/New_York',0,'2026-01-01T00:00:00Z')",
    "INSERT INTO sessions (id,title,location_id,local_night_date,status,created_at,updated_at,source) "
    "VALUES ('s1','Plan','loc1','2026-11-02','planned','x','x','both')",
    "INSERT INTO library_targets (id,catalog_target_id,normalized_key,kind,created_at) "
    "VALUES ('lt1','m31','catalog:m31','catalog','x')",
    "INSERT INTO session_targets (id,session_id,target_id,sort_order,library_target_id) "
    "VALUES ('st1','s1','m31',0,'lt1')",
    "INSERT INTO capture_sets (id,session_id,library_target_id,device,equipment_snapshot,created_at) "
    "VALUES ('cs1','s1','lt1','seestar','{}','x')",
    "INSERT INTO capture_frames (id,capture_set_id,date_obs_utc,exptime_s,source_filename,dedup_key,imported_at) "
    "VALUES ('f1','cs1','2026-11-02T01:00:00Z',10,'a.fit','k1','x')",
    "INSERT INTO capture_frames (id,capture_set_id,date_obs_utc,exptime_s,source_filename,dedup_key,imported_at) "
    "VALUES ('f2','cs1','2026-11-02T01:00:10Z',10,'b.fit','k2','x')",
    "INSERT INTO stacks (id,library_target_id,session_id,source_filename,provenance,dedup_key,imported_at) "
    "VALUES ('sk1','lt1','s1','s.fit','header','sk-key','x')",
    "INSERT INTO final_images (id,library_target_id,stack_id,source_filename,format,preview_key,thumb_key,"
    "width,height,is_current,chosen_at) VALUES ('fi1','lt1','sk1','f.jpg','jpeg','p','t',1,1,1,'x')",
    "INSERT INTO processing_runs (id,capture_set_id,step_states,choices,comparison,created_at,updated_at) "
    "VALUES ('pr1','cs1','{}','{}','{}','x','x')",
]

# Every foreign-key value the seed wrote: (table, id, column) -> value.
SEED_LINKS = {
    ("sessions", "s1", "location_id"): "loc1",
    ("session_targets", "st1", "session_id"): "s1",
    ("session_targets", "st1", "library_target_id"): "lt1",
    ("capture_sets", "cs1", "session_id"): "s1",
    ("capture_sets", "cs1", "library_target_id"): "lt1",
    ("capture_frames", "f1", "capture_set_id"): "cs1",
    ("capture_frames", "f2", "capture_set_id"): "cs1",
    ("stacks", "sk1", "library_target_id"): "lt1",
    ("stacks", "sk1", "session_id"): "s1",
    ("final_images", "fi1", "library_target_id"): "lt1",
    ("final_images", "fi1", "stack_id"): "sk1",
    ("processing_runs", "pr1", "capture_set_id"): "cs1",
}


def _alembic_cfg(url: str):
    from alembic.config import Config
    from app.db import BACKEND_DIR
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url)
    return cfg


def _at_0006_with_seed(url: str, extra: tuple[str, ...] = ()) -> None:
    from alembic import command
    command.upgrade(_alembic_cfg(url), "0006_accounts")
    eng = create_engine(url)  # plain engine: foreign keys off, as for any raw seed
    with eng.begin() as c:
        for sql in (*SEED_0006, *extra):
            c.execute(text(sql))
    eng.dispose()


def _counts(conn) -> dict[str, int]:
    return {t: conn.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar() for t in SEEDED_TABLES}


def _schema(url: str) -> dict[str, dict]:
    eng = create_engine(url)
    insp = sqlalchemy.inspect(eng)
    out = {}
    for t in OWNED_TABLES:
        out[t] = {
            "fks": {(fk["name"], tuple(fk["constrained_columns"]), fk["referred_table"],
                     tuple(fk["referred_columns"]), fk["options"].get("ondelete"))
                    for fk in insp.get_foreign_keys(t)},
            "indexes": {(i["name"], tuple(i["column_names"]), bool(i["unique"])) for i in insp.get_indexes(t)},
            "uniques": {tuple(u["column_names"]) for u in insp.get_unique_constraints(t)},
            "defaults": {c["name"]: c["default"] for c in insp.get_columns(t) if c["default"] is not None},
        }
    eng.dispose()
    return out


def test_0007_keeps_every_row_and_link(tmp_path):
    url = f"sqlite:///{tmp_path / 'own.db'}"
    _at_0006_with_seed(url)
    eng = create_engine(url)
    with eng.connect() as c:
        before = _counts(c)
    eng.dispose()
    assert all(n > 0 for n in before.values()), before

    db = Database(url)
    db.init()

    with db.engine.connect() as c:
        assert _counts(c) == before
        for (table, row_id, col), value in SEED_LINKS.items():
            got = c.execute(text(f"SELECT {col} FROM {table} WHERE id = :id"), {"id": row_id}).scalar()
            assert got == value, (table, row_id, col)
        for t in OWNED_TABLES:
            assert c.execute(text(f"SELECT COUNT(*) FROM {t} WHERE owner_id IS NOT NULL")).scalar() == 0, t
        assert c.execute(text("SELECT source FROM sessions WHERE id='s1'")).scalar() == "both"
        assert c.execute(text("SELECT version_num FROM alembic_version")).scalar() == _head_revision()
        assert c.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1  # the migration's pooled connection
    db.engine.dispose()
    fresh = Database(url)
    with fresh.engine.connect() as c:
        assert c.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
    fresh.engine.dispose()


def test_0007_rebuild_keeps_every_other_constraint(tmp_path):
    """Only the owner FK and index are added and the three global uniques swapped; nothing else moves."""
    url = f"sqlite:///{tmp_path / 'schema.db'}"
    _at_0006_with_seed(url)
    before = _schema(url)
    Database(url).init()
    after = _schema(url)
    swapped = {"library_targets": (("normalized_key",), ("owner_id", "normalized_key")),
               "capture_frames": (("dedup_key",), ("owner_id", "dedup_key")),
               "stacks": (("dedup_key",), ("owner_id", "dedup_key"))}
    for t in OWNED_TABLES:
        owner_fk = (f"fk_{t}_owner", ("owner_id",), "users", ("id",), "RESTRICT")
        assert after[t]["fks"] == before[t]["fks"] | {owner_fk}, t
        assert after[t]["indexes"] == before[t]["indexes"] | {(f"ix_{t}_owner_id", ("owner_id",), False)}, t
        expected = set(before[t]["uniques"])
        if t in swapped:
            old, new = swapped[t]
            expected = (expected - {old}) | {new}
        assert after[t]["uniques"] == expected, t
        assert after[t]["defaults"] == before[t]["defaults"], t
    assert ("session_id", "library_target_id", "device") in after["capture_sets"]["uniques"]
    assert ("capture_set_id",) in after["processing_runs"]["uniques"]
    assert "source" in after["sessions"]["defaults"]


def test_0007_refuses_and_changes_nothing_when_references_would_break(tmp_path):
    url = f"sqlite:///{tmp_path / 'broken.db'}"
    _at_0006_with_seed(url, extra=(
        "INSERT INTO session_targets (id,session_id,target_id,sort_order,library_target_id) "
        "VALUES ('st-ghost','s1','m33',1,'no-such-target')",))
    eng = create_engine(url)
    with eng.connect() as c:
        before = _counts(c)
    eng.dispose()

    db = Database(url)
    with pytest.raises(RuntimeError, match="Migration would leave broken references; nothing was changed."):
        db.init()
    with db.engine.connect() as c:
        assert c.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
        assert c.execute(text("SELECT version_num FROM alembic_version")).scalar() == "0006_accounts"
        assert c.execute(text("SELECT name FROM sqlite_master WHERE name LIKE '_alembic_tmp%'")).all() == []
        assert _counts(c) == before
    insp = sqlalchemy.inspect(db.engine)
    for t in OWNED_TABLES:
        assert "owner_id" not in {col["name"] for col in insp.get_columns(t)}, t
    db.engine.dispose()

    eng = create_engine(url)
    with eng.begin() as c:
        c.execute(text("DELETE FROM session_targets WHERE id='st-ghost'"))
    eng.dispose()
    db = Database(url)
    db.init()
    with db.engine.connect() as c:
        assert c.execute(text("SELECT version_num FROM alembic_version")).scalar() == _head_revision()
    db.engine.dispose()


def test_foreign_key_check_runs_only_when_a_revision_ran(tmp_path):
    url = f"sqlite:///{tmp_path / 'athead.db'}"
    Database(url).init()
    eng = create_engine(url)  # foreign keys off: write a reference to nothing
    with eng.begin() as c:
        c.execute(text("INSERT INTO sessions (id,title,local_night_date,status,created_at,updated_at) "
                       "VALUES ('s1','T','2026-11-02','planned','x','x')"))
        c.execute(text("INSERT INTO session_targets (id,session_id,target_id,sort_order,library_target_id) "
                       "VALUES ('st1','s1','m31',0,'no-such-target')"))
    eng.dispose()
    Database(url).init()  # already at head: nothing migrates, so nothing is refused


def test_in_memory_database_keeps_foreign_keys_on_after_init():
    db = Database("sqlite:///:memory:")
    db.init()
    with db.engine.connect() as c:
        assert c.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1


def _owned_graph_sql(owner: str | None, suffix: str, *, key: str = "custom:x", dedup: str = "same") -> list[str]:
    o = "NULL" if owner is None else f"'{owner}'"
    return [
        f"INSERT INTO sessions (id,title,local_night_date,status,created_at,updated_at,owner_id) "
        f"VALUES ('s{suffix}','T','2026-11-02','planned','x','x',{o})",
        f"INSERT INTO library_targets (id,normalized_key,kind,created_at,owner_id) "
        f"VALUES ('lt{suffix}','{key}','custom','x',{o})",
        f"INSERT INTO capture_sets (id,session_id,library_target_id,device,equipment_snapshot,created_at,owner_id) "
        f"VALUES ('cs{suffix}','s{suffix}','lt{suffix}','seestar','{{}}','x',{o})",
        f"INSERT INTO capture_frames (id,capture_set_id,date_obs_utc,exptime_s,source_filename,dedup_key,"
        f"imported_at,owner_id) VALUES ('f{suffix}','cs{suffix}','2026-11-02T01:00:00Z',10,'a.fit','{dedup}','x',{o})",
        f"INSERT INTO stacks (id,library_target_id,source_filename,provenance,dedup_key,imported_at,owner_id) "
        f"VALUES ('sk{suffix}','lt{suffix}','s.fit','header','{dedup}','x',{o})",
    ]


def _users_sql(*ids: str) -> list[str]:
    return [f"INSERT INTO users (id,email,password_hash,created_at) VALUES ('{u}','{u}@example.com','h','x')"
            for u in ids]


def test_0007_unique_keys_are_per_owner(tmp_path):
    from sqlalchemy.exc import IntegrityError
    db = Database(f"sqlite:///{tmp_path / 'per.db'}")
    db.init()
    with db.engine.begin() as c:
        # The same library key, frame dedup key and stack dedup key, once for each of two owners.
        for sql in [*_users_sql("u1", "u2"), *_owned_graph_sql("u1", "1"), *_owned_graph_sql("u2", "2")]:
            c.execute(text(sql))
    dupes = [
        "INSERT INTO library_targets (id,normalized_key,kind,created_at,owner_id) "
        "VALUES ('lt-dup','custom:x','custom','x','u1')",
        "INSERT INTO capture_frames (id,capture_set_id,date_obs_utc,exptime_s,source_filename,dedup_key,"
        "imported_at,owner_id) VALUES ('f-dup','cs1','2026-11-02T01:00:00Z',10,'a.fit','same','x','u1')",
        "INSERT INTO stacks (id,library_target_id,source_filename,provenance,dedup_key,imported_at,owner_id) "
        "VALUES ('sk-dup','lt1','s.fit','header','same','x','u1')",
    ]
    for sql in dupes:
        with pytest.raises(IntegrityError):
            with db.engine.begin() as c:
                c.execute(text(sql))
    with db.engine.connect() as c:
        for t in ("library_targets", "capture_frames", "stacks"):
            assert c.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar() == 2, t
    db.engine.dispose()


def test_0007_downgrade_restores_global_uniques(tmp_path):
    from alembic import command
    from sqlalchemy.exc import IntegrityError
    url = f"sqlite:///{tmp_path / 'down.db'}"
    run_migrations(url)
    eng = create_engine(url)
    with eng.begin() as c:
        for sql in [*_users_sql("u1"), *_owned_graph_sql("u1", "1"),
                    *_owned_graph_sql(None, "2", key="custom:y", dedup="other")]:
            c.execute(text(sql))
    cfg = _alembic_cfg(url)
    command.downgrade(cfg, "0006_accounts")
    insp = sqlalchemy.inspect(eng)
    for t in OWNED_TABLES:
        assert "owner_id" not in {col["name"] for col in insp.get_columns(t)}, t
    with eng.connect() as c:
        for t in ("sessions", "library_targets", "capture_sets", "capture_frames", "stacks"):
            assert c.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar() == 2, t
    for sql in [
        "INSERT INTO library_targets (id,normalized_key,kind,created_at) VALUES ('lt-dup','custom:x','custom','x')",
        "INSERT INTO capture_frames (id,capture_set_id,date_obs_utc,exptime_s,source_filename,dedup_key,imported_at)"
        " VALUES ('f-dup','cs1','2026-11-02T01:00:00Z',10,'a.fit','same','x')",
        "INSERT INTO stacks (id,library_target_id,source_filename,provenance,dedup_key,imported_at) "
        "VALUES ('sk-dup','lt1','s.fit','header','same','x')",
    ]:
        with pytest.raises(IntegrityError):
            with eng.begin() as c:
                c.execute(text(sql))
    command.upgrade(cfg, "head")  # the restored uniques are found again on the way back up
    assert "owner_id" in {col["name"] for col in sqlalchemy.inspect(eng).get_columns("library_targets")}
    eng.dispose()

