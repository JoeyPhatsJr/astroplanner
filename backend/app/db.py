"""SQLite persistence (SQLAlchemy 2.0).

The schema is managed by Alembic migrations (``backend/migrations``); ``init()``
upgrades to head and the built-in records are upserted by ``seed()``. Both are
safe to re-run. A pre-Alembic Phase 1 database is stamped at the baseline first.
"""

from __future__ import annotations

import math
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, create_engine, event, inspect, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker
from sqlalchemy.pool import StaticPool

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "astroplanner.db"


def database_url() -> str:
    """DATABASE_URL (e.g. Supabase Postgres) or a local SQLite file for development."""
    url = os.environ.get("DATABASE_URL")
    if url:
        # Supabase/Heroku-style URLs -> SQLAlchemy psycopg driver
        if url.startswith("postgres://"):
            url = "postgresql+psycopg://" + url[len("postgres://"):]
        elif url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://"):]
        return url
    path = Path(os.environ.get("ASTROPLANNER_DB", DEFAULT_DB))
    path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{path}"


BASELINE_REVISION = "0001_phase1_baseline"
BACKEND_DIR = Path(__file__).resolve().parent.parent


def run_migrations(url: str, engine: Engine | None = None) -> None:
    """Upgrade the database at ``url`` to head, stamping a pre-Alembic Phase 1 DB first.

    Pass ``engine`` to reuse an existing engine (required for in-memory SQLite).
    """
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    own = engine is None
    engine = engine or create_engine(url)
    try:
        with engine.begin() as conn:
            cfg.attributes["connection"] = conn
            tables = set(inspect(conn).get_table_names())
            if "observing_locations" in tables and "alembic_version" not in tables:
                command.stamp(cfg, BASELINE_REVISION)
            command.upgrade(cfg, "head")
    finally:
        if own:
            engine.dispose()


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _uuid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class ObservingLocation(Base):
    __tablename__ = "observing_locations"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    label: Mapped[str] = mapped_column(String(120))
    latitude_deg: Mapped[float] = mapped_column(Float)
    longitude_deg: Mapped[float] = mapped_column(Float)
    elevation_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    timezone: Mapped[str] = mapped_column(String(64))
    is_sample: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(String, default=_utcnow)


class EquipmentProfile(Base):
    __tablename__ = "equipment_profiles"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120))
    manufacturer: Mapped[str | None] = mapped_column(String(120), nullable=True)
    aperture_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    focal_length_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    fov_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    fov_definition: Mapped[str] = mapped_column(String(16), default="unknown")
    wide_fov_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    sensor: Mapped[str | None] = mapped_column(String(120), nullable=True)
    mount_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    is_preset: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(String, default=_utcnow)


class ObservingSession(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(160))
    location_id: Mapped[str | None] = mapped_column(ForeignKey("observing_locations.id", ondelete="RESTRICT"), nullable=True)
    equipment_id: Mapped[str | None] = mapped_column(ForeignKey("equipment_profiles.id", ondelete="RESTRICT"), nullable=True)
    local_night_date: Mapped[str] = mapped_column(String(10))
    start_utc: Mapped[str | None] = mapped_column(String, nullable=True)
    end_utc: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="planned")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(16), default="planned", server_default="planned")  # planned|imported|both
    created_at: Mapped[str] = mapped_column(String, default=_utcnow)
    updated_at: Mapped[str] = mapped_column(String, default=_utcnow, onupdate=_utcnow)
    targets: Mapped[list["SessionTarget"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="SessionTarget.sort_order"
    )


class SessionTarget(Base):
    __tablename__ = "session_targets"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    target_id: Mapped[str] = mapped_column(String(32))
    planned_start_utc: Mapped[str | None] = mapped_column(String, nullable=True)
    planned_end_utc: Mapped[str | None] = mapped_column(String, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    actual_integration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    library_target_id: Mapped[str | None] = mapped_column(
        ForeignKey("library_targets.id", ondelete="SET NULL"), nullable=True
    )
    session: Mapped[ObservingSession] = relationship(back_populates="targets")


class AppMeta(Base):
    __tablename__ = "app_meta"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)


import app.astrolog.models  # noqa: E402,F401  (registers Phase 2 tables on Base.metadata)

SEESTAR_S30 = {
    "id": "seestar-s30",
    "name": "Seestar S30 (original)",
    "manufacturer": "ZWO Seestar",
    "aperture_mm": 30.0,
    "focal_length_mm": 150.0,
    "fov_deg": 2.46,
    "fov_definition": "unknown",
    "wide_fov_deg": 23.2,
    "sensor": "Sony IMX662 (telephoto)",
    "mount_type": "Alt-azimuth (equatorial mode supported per manufacturer)",
    "source_url": "https://us.seestar.com/products/seestar-s30-all-in-one-smart-telescope",
    "notes": (
        "Original S30, not the S30 Pro. Manufacturer-published: 30 mm aperture, 150 mm focal length (f/5), "
        "IMX662, telephoto FOV 2.46°, wide-angle FOV 23.2°, JPEG/FITS output. Whether 2.46° is horizontal, "
        "vertical or diagonal is not stated, so framing is approximate."
    ),
    "is_verified": True,
    "is_preset": True,
}

# Canon EOS Rebel T3 (APS-C, 22.0 x 14.7 mm) with the kit EF-S 18-55 mm lens at its wide end.
_CANON_SENSOR_MM = (22.0, 14.7)
CANON_T3 = {
    "id": "canon-t3-18-55",
    "name": "Canon EOS Rebel T3 + EF-S 18–55 mm",
    "manufacturer": "Canon",
    "focal_length_mm": 18.0,
    "fov_deg": round(math.degrees(2 * math.atan(math.hypot(*_CANON_SENSOR_MM) / (2 * 18.0))), 2),
    "fov_definition": "diagonal",
    "sensor": "APS-C CMOS 22.0 x 14.7 mm",
    "notes": (
        "Kit zoom lens covers 18–55 mm; this profile assumes 18 mm. Field of view is the approximate diagonal "
        "for a 22.0 x 14.7 mm sensor. Edit the focal length if you shot at a different zoom setting."
    ),
    "is_verified": False,
    "is_preset": False,
}

SAMPLE_LOCATION = {
    "id": "sample-location",
    "label": "Sample location: Philadelphia, PA (edit me)",
    "latitude_deg": 39.9526,
    "longitude_deg": -75.1652,
    "elevation_m": 12.0,
    "timezone": "America/New_York",
    "is_sample": True,
}


class Database:
    def __init__(self, url: str | None = None):
        url = url or database_url()
        is_sqlite = url.startswith("sqlite")
        if is_sqlite:
            extra = {"poolclass": StaticPool} if ":memory:" in url else {}  # one shared in-memory DB
            self.engine = create_engine(url, connect_args={"check_same_thread": False}, **extra)

            @event.listens_for(self.engine, "connect")
            def _fk_on(dbapi_conn, _):  # SQLite needs foreign keys enabled per connection
                dbapi_conn.execute("PRAGMA foreign_keys=ON")
        else:
            # Postgres (e.g. Supabase). pool_pre_ping survives serverless idle disconnects.
            self.engine = create_engine(url, pool_pre_ping=True, pool_size=2, max_overflow=2)

        self.url = url
        self.SessionLocal = sessionmaker(bind=self.engine, expire_on_commit=False)

    def init(self) -> None:
        run_migrations(self.url, self.engine)
        self.seed()

    def seed(self) -> None:
        with self.SessionLocal() as s:
            preset = s.get(EquipmentProfile, SEESTAR_S30["id"])
            if preset is None:
                s.add(EquipmentProfile(**SEESTAR_S30))
            else:  # keep the preset canonical even if a previous version differed
                for k, v in SEESTAR_S30.items():
                    setattr(preset, k, v)
            if s.get(AppMeta, "canon_seeded") is None:  # once ever: a deleted profile stays deleted
                if s.get(EquipmentProfile, CANON_T3["id"]) is None:
                    s.add(EquipmentProfile(**CANON_T3))
                s.add(AppMeta(key="canon_seeded", value="1"))
            if s.scalar(select(ObservingLocation).limit(1)) is None:
                s.add(ObservingLocation(**SAMPLE_LOCATION))
            s.commit()

    def session(self) -> Session:
        return self.SessionLocal()
