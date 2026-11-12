"""Phase 4 (Processing Coach) tables and the step vocabulary shared by rules, steps and routes."""

from __future__ import annotations

from typing import Any, Literal

from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, _utcnow, _uuid, owner_column

# Where a piece of advice or a finding comes from (see rules.py for the meanings).
Basis = Literal["measured", "siril-docs", "tutorial-default", "taste"]

StepId = Literal["report", "convert", "align", "select", "stack", "background", "colour", "stretch", "finish", "compare"]
STEP_ORDER: tuple[StepId, ...] = (
    "report", "convert", "align", "select", "stack", "background", "colour", "stretch", "finish", "compare",
)
STEP_TITLES: dict[str, str] = {
    "report": "Night report",
    "convert": "Convert & debayer",
    "align": "Align",
    "select": "Choose frames",
    "stack": "Stack",
    "background": "Background",
    "colour": "Colour",
    "stretch": "Stretch",
    "finish": "Stars & finish",
    "compare": "Compare",
}


class ProcessingRun(Base):
    """One coached processing attempt for one capture set (one night of one target on one device).

    Never stores absolute paths or header coordinates: `folder` (filled by a later task) holds only
    names the user confirmed, and the measured numbers come from files the user chooses to read."""

    __tablename__ = "processing_runs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    owner_id: Mapped[str | None] = owner_column("processing_runs")
    capture_set_id: Mapped[str] = mapped_column(
        ForeignKey("capture_sets.id", ondelete="RESTRICT"), unique=True)
    siril_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    step_states: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    choices: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    folder: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    frame_stats: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    comparison: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[str] = mapped_column(String, default=_utcnow)
    updated_at: Mapped[str] = mapped_column(String, default=_utcnow, onupdate=_utcnow)
