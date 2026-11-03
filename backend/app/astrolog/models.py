"""Phase 2 (Astrolog) tables: the library of targets, captured frames, stacks and final images."""

from __future__ import annotations

from typing import Any, Literal

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, _utcnow, _uuid

TargetKind = Literal["catalog", "custom", "unsorted"]
Provenance = Literal["header", "filename"]


class LibraryTarget(Base):
    __tablename__ = "library_targets"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    catalog_target_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    custom_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    normalized_key: Mapped[str] = mapped_column(String(200), unique=True)
    kind: Mapped[str] = mapped_column(String(16))  # TargetKind
    # Header RA/Dec of the OBJECT (not the site), kept as provenance for custom targets.
    ra_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    dec_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=_utcnow)


class CaptureSet(Base):
    __tablename__ = "capture_sets"
    __table_args__ = (UniqueConstraint("session_id", "library_target_id", "device", name="uq_capture_set"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="RESTRICT"), index=True)
    library_target_id: Mapped[str] = mapped_column(ForeignKey("library_targets.id", ondelete="RESTRICT"), index=True)
    device: Mapped[str] = mapped_column(String(64))
    equipment_id: Mapped[str | None] = mapped_column(
        ForeignKey("equipment_profiles.id", ondelete="SET NULL"), nullable=True
    )
    equipment_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[str] = mapped_column(String, default=_utcnow)


class CaptureFrame(Base):
    __tablename__ = "capture_frames"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    capture_set_id: Mapped[str] = mapped_column(ForeignKey("capture_sets.id", ondelete="CASCADE"), index=True)
    date_obs_utc: Mapped[str] = mapped_column(String)
    exptime_s: Mapped[float] = mapped_column(Float)
    filter: Mapped[str | None] = mapped_column(String(64), nullable=True)
    gain: Mapped[float | None] = mapped_column(Float, nullable=True)
    ccd_temp_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_filename: Mapped[str] = mapped_column(String(512))
    dedup_key: Mapped[str] = mapped_column(String(200), unique=True)
    imported_at: Mapped[str] = mapped_column(String, default=_utcnow)


class Stack(Base):
    __tablename__ = "stacks"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    library_target_id: Mapped[str] = mapped_column(ForeignKey("library_targets.id", ondelete="RESTRICT"), index=True)
    session_id: Mapped[str | None] = mapped_column(ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True)
    source_filename: Mapped[str] = mapped_column(String(512))
    stack_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    livetime_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    exptime_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    expstart_jd: Mapped[float | None] = mapped_column(Float, nullable=True)
    expend_jd: Mapped[float | None] = mapped_column(Float, nullable=True)
    program: Mapped[str | None] = mapped_column(String(120), nullable=True)
    provenance: Mapped[str] = mapped_column(String(16))  # Provenance
    dedup_key: Mapped[str] = mapped_column(String(200), unique=True)
    imported_at: Mapped[str] = mapped_column(String, default=_utcnow)


class FinalImage(Base):
    __tablename__ = "final_images"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    library_target_id: Mapped[str] = mapped_column(ForeignKey("library_targets.id", ondelete="RESTRICT"), index=True)
    stack_id: Mapped[str | None] = mapped_column(ForeignKey("stacks.id", ondelete="SET NULL"), nullable=True, index=True)
    source_filename: Mapped[str] = mapped_column(String(512))
    format: Mapped[str] = mapped_column(String(16))
    preview_key: Mapped[str] = mapped_column(String(512))
    thumb_key: Mapped[str] = mapped_column(String(512))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)
    chosen_at: Mapped[str] = mapped_column(String, default=_utcnow)
