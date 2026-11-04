"""Processing Coach routes: /api/processing/runs. Thin; copy and rules live in steps.py / rules.py."""

from __future__ import annotations

from collections import Counter
from dataclasses import asdict
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import astronomy, targets
from app.api import get_db
from app.astrolog import library
from app.astrolog.models import CaptureFrame, CaptureSet, LibraryTarget
from app.db import ObservingLocation, ObservingSession, _utcnow

from .models import ProcessingRun, StepId
from .report import AltitudeFn, FolderError, FolderResult, Report, UploadedText, build_folder, night_report
from .rules import Facts
from .selection import LastChoice, SelectionOption, selection_options
from .seq import SeqParseError
from .steps import build_steps

router = APIRouter(prefix="/api/processing", tags=["processing"])

SIRIL_TARGET = "1.4.5"
SEESTAR_ONLY = "The coach supports Seestar S30 FITS nights only."


class RunIn(BaseModel):
    capture_set_id: str = Field(..., min_length=1, max_length=64)


MAX_TEXT_CHARS = 5 * 1024 * 1024  # the browser sends only .seq / *_conversion.txt files of at most 5 MB


class UploadedTextIn(BaseModel):
    path: str = Field(..., min_length=1, max_length=512)
    text: str = Field(..., max_length=MAX_TEXT_CHARS)


class SirilFolderIn(BaseModel):
    run_dir: str = Field(..., min_length=1, max_length=512)
    files: list[UploadedTextIn] = Field(..., min_length=1, max_length=50)
    calibration_dirs: list[str] = Field(default_factory=list, max_length=50)


# Keys a client may write into ProcessingRun.choices. ``selection_summary`` is written by the server only.
CHOICE_KEYS = ("selection", "filter")


class RunPatch(BaseModel):
    step_states: dict[StepId, Literal["todo", "done"]] | None = None
    choices: dict[str, Any] | None = None


def _frames(db: Session, cs: CaptureSet) -> list[CaptureFrame]:
    return list(db.scalars(select(CaptureFrame).where(CaptureFrame.capture_set_id == cs.id)))


def _facts(frames: list[CaptureFrame], report: Report | None = None) -> Facts:
    patterns = {f.bayer_pattern for f in frames}
    exptimes = {float(f.exptime_s) for f in frames}
    return Facts(
        bayer_pattern=next(iter(patterns)) if len(patterns) == 1 and None not in patterns else None,
        frame_count=len(frames),
        exptime_s=next(iter(exptimes)) if len(exptimes) == 1 else None,
        report=report)


def _modal_exptime(frames: list[CaptureFrame]) -> float:
    counts = Counter(float(f.exptime_s) for f in frames)
    return max(counts.items(), key=lambda kv: (kv[1], kv[0]))[0] if counts else 0.0


def _altitude_fn(lt: LibraryTarget, loc: ObservingLocation | None) -> AltitudeFn | None:
    """Target altitude over the night's site, closed over so coordinates never leave this function."""
    if loc is None:
        return None
    ra, dec = lt.ra_deg, lt.dec_deg
    if lt.catalog_target_id:
        t = targets.lookup(lt.catalog_target_id)
        if t is not None and t.get("ra_deg") is not None and t.get("dec_deg") is not None:
            ra, dec = float(t["ra_deg"]), float(t["dec_deg"])
    if ra is None or dec is None:
        return None
    lat, lon = loc.latitude_deg, loc.longitude_deg
    return lambda utcs: astronomy.altitude_deg(ra, dec, lat, lon, utcs)


def _report(run: ProcessingRun, frames: list[CaptureFrame], lt: LibraryTarget,
            loc: ObservingLocation | None) -> Report | None:
    if not run.folder or not run.frame_stats:
        return None
    folder = FolderResult.from_store(run.folder, run.frame_stats)
    return night_report(folder, _modal_exptime(frames), loc.timezone if loc else None,
                        altitude=_altitude_fn(lt, loc))


def _options(run: ProcessingRun, frames: list[CaptureFrame], report: Report | None) -> list[SelectionOption]:
    if report is None or not run.frame_stats:
        return []
    stats = FolderResult.from_store(run.folder or {}, run.frame_stats).frames if run.folder else []
    cut = next((f.value for f in report.findings if f.id == "round_cut"), None)
    return selection_options(stats, _modal_exptime(frames), cut, None)


def _last_time(db: Session, run: ProcessingRun, cs: CaptureSet) -> LastChoice | None:
    """The most recent other run on the same device whose frame choice was saved. A note only, never a default."""
    rows = db.execute(
        select(ProcessingRun, CaptureSet, LibraryTarget, ObservingSession)
        .join(CaptureSet, CaptureSet.id == ProcessingRun.capture_set_id)
        .join(LibraryTarget, LibraryTarget.id == CaptureSet.library_target_id)
        .join(ObservingSession, ObservingSession.id == CaptureSet.session_id)
        .where(ProcessingRun.id != run.id, func.lower(CaptureSet.device) == cs.device.casefold())
        .order_by(ProcessingRun.updated_at.desc())).all()
    for other, _cs, lt, sess in rows:
        summary = (other.choices or {}).get("selection_summary")
        if (other.choices or {}).get("selection") and isinstance(summary, dict):
            return LastChoice(sess.local_night_date, library.display_name(lt),
                              str(summary.get("option_label", "")), int(summary.get("kept", 0)))
    return None


def run_out(db: Session, run: ProcessingRun) -> dict[str, Any]:
    cs = db.get(CaptureSet, run.capture_set_id)
    lt = db.get(LibraryTarget, cs.library_target_id)
    sess = db.get(ObservingSession, cs.session_id)
    loc = db.get(ObservingLocation, sess.location_id) if sess.location_id else None
    frames = _frames(db, cs)
    report = _report(run, frames, lt, loc)
    facts = _facts(frames, report)
    return {
        "id": run.id,
        "capture_set_id": run.capture_set_id,
        "target": {"id": lt.id, "name": library.display_name(lt)},
        "night": {"session_id": sess.id, "night_date": sess.local_night_date, "timezone": loc.timezone if loc else None},
        "frames": facts.frame_count,
        "exptime_s": facts.exptime_s,
        "steps": [asdict(s) for s in build_steps(facts, run.step_states or {})],
        "folder": run.folder,
        "report": asdict(report) if report is not None else None,
        "selection": [asdict(o) for o in _options(run, frames, report)],
        "selection_last_time": asdict(last) if (last := _last_time(db, run, cs)) else None,
        "choices": {k: v for k, v in (run.choices or {}).items() if k in CHOICE_KEYS},
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
        unknown = sorted(set(body.choices) - set(CHOICE_KEYS))
        if unknown:
            raise HTTPException(422, f"Unknown choice: {', '.join(unknown)}")
        extra: dict[str, Any] = {}
        if "selection" in body.choices:
            chosen = body.choices["selection"]
            cs = db.get(CaptureSet, run.capture_set_id)
            offered = {o.id: o for o in _options(run, _frames(db, cs), _report(
                run, _frames(db, cs), db.get(LibraryTarget, cs.library_target_id), None))}
            if not isinstance(chosen, str) or chosen not in offered:
                raise HTTPException(422, "That frame selection isn't one of the options offered for this run")
            extra["selection_summary"] = {"option_label": offered[chosen].label, "kept": offered[chosen].kept}
        run.choices = {**(run.choices or {}), **body.choices, **extra}
    run.updated_at = _utcnow()
    db.commit()
    return run_out(db, run)


@router.post("/runs/{run_id}/siril-folder")
def upload_siril_folder(run_id: str, body: SirilFolderIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Read one Siril working folder's .seq and conversion text for this night. Stores names and Siril's
    numbers only; the run is left unchanged when the folder is rejected."""
    run = _get_run(db, run_id)
    frames = _frames(db, db.get(CaptureSet, run.capture_set_id))
    try:
        folder = build_folder(
            [UploadedText(f.path, f.text) for f in body.files], body.calibration_dirs,
            {f.source_filename: f.date_obs_utc for f in frames}, run_dir=body.run_dir,
            frame_exptimes={f.source_filename: float(f.exptime_s) for f in frames})
    except (SeqParseError, FolderError) as e:
        raise HTTPException(422, str(e)) from e
    run.folder, run.frame_stats = folder.to_store()
    # The options (and their counts) come from this folder, so a choice made on the previous one no longer applies.
    had_selection = bool((run.choices or {}).get("selection"))
    run.choices = {k: v for k, v in (run.choices or {}).items() if k not in ("selection", "selection_summary")}
    run.updated_at = _utcnow()
    db.commit()
    # Only this response says so, so the UI can tell the user their frame choice was dropped.
    return {**run_out(db, run), "selection_cleared": had_selection}
