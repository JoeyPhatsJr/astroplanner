"""Processing Coach routes: /api/processing/runs. Thin; copy and rules live in steps.py / rules.py."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api import get_db
from app.astrolog import library
from app.astrolog.models import CaptureFrame, CaptureSet, LibraryTarget
from app.db import ObservingLocation, ObservingSession, _utcnow

from .models import ProcessingRun, StepId
from .rules import Facts
from .steps import build_steps

router = APIRouter(prefix="/api/processing", tags=["processing"])

SIRIL_TARGET = "1.4.5"
SEESTAR_ONLY = "The coach supports Seestar S30 FITS nights only."


class RunIn(BaseModel):
    capture_set_id: str = Field(..., min_length=1, max_length=64)


class RunPatch(BaseModel):
    step_states: dict[StepId, Literal["todo", "done"]] | None = None
    choices: dict[str, Any] | None = None


def _frames(db: Session, cs: CaptureSet) -> list[CaptureFrame]:
    return list(db.scalars(select(CaptureFrame).where(CaptureFrame.capture_set_id == cs.id)))


def _facts(frames: list[CaptureFrame]) -> Facts:
    patterns = {f.bayer_pattern for f in frames}
    exptimes = {float(f.exptime_s) for f in frames}
    return Facts(
        bayer_pattern=next(iter(patterns)) if len(patterns) == 1 and None not in patterns else None,
        frame_count=len(frames),
        exptime_s=next(iter(exptimes)) if len(exptimes) == 1 else None)


def run_out(db: Session, run: ProcessingRun) -> dict[str, Any]:
    cs = db.get(CaptureSet, run.capture_set_id)
    lt = db.get(LibraryTarget, cs.library_target_id)
    sess = db.get(ObservingSession, cs.session_id)
    loc = db.get(ObservingLocation, sess.location_id) if sess.location_id else None
    frames = _frames(db, cs)
    facts = _facts(frames)
    return {
        "id": run.id,
        "capture_set_id": run.capture_set_id,
        "target": {"id": lt.id, "name": library.display_name(lt)},
        "night": {"session_id": sess.id, "night_date": sess.local_night_date, "timezone": loc.timezone if loc else None},
        "frames": facts.frame_count,
        "exptime_s": facts.exptime_s,
        "steps": [asdict(s) for s in build_steps(facts, run.step_states or {})],
        "report": None,  # filled by the report task
        "selection": [],  # filled by the selection task
        "comparison": run.comparison or {},
        "siril_target": SIRIL_TARGET,
    }


def _get_run(db: Session, run_id: str) -> ProcessingRun:
    run = db.get(ProcessingRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    return run


@router.post("/runs")
def create_run(body: RunIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    cs = db.get(CaptureSet, body.capture_set_id)
    if cs is None:
        raise HTTPException(404, "Capture set not found")
    if cs.device.strip().casefold() != "seestar s30":
        raise HTTPException(422, SEESTAR_ONLY)
    run = db.scalars(select(ProcessingRun).where(ProcessingRun.capture_set_id == cs.id)).first()
    if run is None:
        run = ProcessingRun(capture_set_id=cs.id, step_states={}, choices={}, comparison={})
        db.add(run)
        try:
            db.commit()
        except IntegrityError:  # a concurrent request created it first
            db.rollback()
            run = db.scalars(select(ProcessingRun).where(ProcessingRun.capture_set_id == cs.id)).one()
    return run_out(db, run)


@router.get("/runs/{run_id}")
def get_run(run_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    return run_out(db, _get_run(db, run_id))


@router.patch("/runs/{run_id}")
def patch_run(run_id: str, body: RunPatch, db: Session = Depends(get_db)) -> dict[str, Any]:
    run = _get_run(db, run_id)
    if body.step_states:
        run.step_states = {**(run.step_states or {}), **body.step_states}  # new dict: JSON columns aren't mutation-tracked
    if body.choices is not None:
        run.choices = {**(run.choices or {}), **body.choices}
    run.updated_at = _utcnow()
    db.commit()
    return run_out(db, run)
