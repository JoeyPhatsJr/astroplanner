"""Phase 2 (Astrolog) tables: the library of targets, captured frames, stacks and final images."""

from __future__ import annotations

from typing import Any, Literal

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, _utcnow, _uuid, owner_column

TargetKind = Literal["catalog", "custom", "unsorted", "variable"]
Provenance = Literal["header", "filename"]


class LibraryTarget(Base):
    __tablename__ = "library_targets"
    # The normalised key (including the single "Unsorted" row) is unique per owner, not across the install.
    __table_args__ = (UniqueConstraint("owner_id", "normalized_key", name="uq_library_targets_owner_key"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    owner_id: Mapped[str | None] = owner_column("library_targets")
    catalog_target_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    custom_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    normalized_key: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(16))  # TargetKind
    # Header RA/Dec of the OBJECT (not the site), kept as provenance for custom targets.
    ra_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    dec_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=_utcnow)


class CaptureSet(Base):
    __tablename__ = "capture_sets"
    __table_args__ = (UniqueConstraint("session_id", "library_target_id", "device", name="uq_capture_set"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    owner_id: Mapped[str | None] = owner_column("capture_sets")
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="RESTRICT"), index=True)
    library_target_id: Mapped[str] = mapped_column(ForeignKey("library_targets.id", ondelete="RESTRICT"), index=True)
    device: Mapped[str] = mapped_column(String(64))
    equipment_id: Mapped[str | None] = mapped_column(
        ForeignKey("equipment_profiles.id", ondelete="SET NULL"), nullable=True
    )
    equipment_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    lens: Mapped[str | None] = mapped_column(String(120), nullable=True)  # Canon EXIF LensModel
    created_at: Mapped[str] = mapped_column(String, default=_utcnow)


class CaptureFrame(Base):
    __tablename__ = "capture_frames"
    __table_args__ = (UniqueConstraint("owner_id", "dedup_key", name="uq_capture_frames_owner_dedup"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    owner_id: Mapped[str | None] = owner_column("capture_frames")
    capture_set_id: Mapped[str] = mapped_column(ForeignKey("capture_sets.id", ondelete="CASCADE"), index=True)
    date_obs_utc: Mapped[str] = mapped_column(String)
    exptime_s: Mapped[float] = mapped_column(Float)
    filter: Mapped[str | None] = mapped_column(String(64), nullable=True)
    gain: Mapped[float | None] = mapped_column(Float, nullable=True)
    ccd_temp_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Canon EXIF (ISOSpeedRatings, FNumber, FocalLength); null for FITS frames.
    iso: Mapped[int | None] = mapped_column(Integer, nullable=True)
    f_number: Mapped[float | None] = mapped_column(Float, nullable=True)
    focal_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    # FITS BAYERPAT (e.g. GRBG) as read from the header; null for Canon frames and older imports.
    bayer_pattern: Mapped[str | None] = mapped_column(String(8), nullable=True)
    source_filename: Mapped[str] = mapped_column(String(512))
    dedup_key: Mapped[str] = mapped_column(String(200))
    imported_at: Mapped[str] = mapped_column(String, default=_utcnow)


class Stack(Base):
    __tablename__ = "stacks"
    __table_args__ = (UniqueConstraint("owner_id", "dedup_key", name="uq_stacks_owner_dedup"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    owner_id: Mapped[str | None] = owner_column("stacks")
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
    dedup_key: Mapped[str] = mapped_column(String(200))
    imported_at: Mapped[str] = mapped_column(String, default=_utcnow)


class FinalImage(Base):
    __tablename__ = "final_images"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    owner_id: Mapped[str | None] = owner_column("final_images")
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
