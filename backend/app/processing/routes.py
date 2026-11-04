"""Processing Coach routes: /api/processing/runs. Thin; copy and rules live in steps.py / rules.py."""

from __future__ import annotations

import io
import math
import uuid
from collections import Counter
from dataclasses import asdict
from pathlib import PurePosixPath
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import PlainTextResponse, Response
from PIL import Image
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import astronomy, targets
from app.api import get_db
from app.astrolog import library, previews
from app.astrolog.routes import _read_limited
from app.astrolog.models import CaptureFrame, CaptureSet, FinalImage, LibraryTarget
from app.db import ObservingLocation, ObservingSession, _utcnow

from .measure import METHOD, StackMeasurement, UnmeasurableStack, measure_stack
from .models import ProcessingRun, StepId
from .report import AltitudeFn, FolderError, FolderResult, Report, UploadedText, build_folder, night_report
from .rules import Facts
from .scripts import SCRIPT_NAMES, SIRIL_REQUIRES, disk_estimate_bytes, prepare_script, stack_script
from .selection import LastChoice, SelectionOption, selection_options
from .seq import SeqParseError
from .steps import build_steps

router = APIRouter(prefix="/api/processing", tags=["processing"])

SIRIL_TARGET = SIRIL_REQUIRES  # "1.4.5": the version the scripts are written and tested for
NO_SELECTION = "Choose which frames to keep first."
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
    comparison: dict[str, Any] | None = None  # only {"seestar_picture": {"edited": bool | null}} is accepted


def _frames(db: Session, cs: CaptureSet) -> list[CaptureFrame]:
    return list(db.scalars(select(CaptureFrame).where(CaptureFrame.capture_set_id == cs.id)))


STACK_SIDES = ("siril", "seestar")


def _stack_of(run: ProcessingRun | None, side: str) -> StackMeasurement | None:
    """The stored measurement for ``side``, or None when absent or made by another method (never compared)."""
    entry = ((run.comparison if run else None) or {}).get(side + "_stack")
    d = entry.get("measurement") if isinstance(entry, dict) else None
    if not isinstance(d, dict) or d.get("method") != METHOD:
        return None
    try:
        ratio = d.get("bg_rgb_ratio")
        return StackMeasurement(**{**d, "bg_rgb_ratio": tuple(ratio) if ratio is not None else None})
    except TypeError:
        return None


def _facts(frames: list[CaptureFrame], report: Report | None = None,
           chosen: SelectionOption | None = None, run: ProcessingRun | None = None) -> Facts:
    patterns = {f.bayer_pattern for f in frames}
    exptimes = {float(f.exptime_s) for f in frames}
    return Facts(
        bayer_pattern=next(iter(patterns)) if len(patterns) == 1 and None not in patterns else None,
        frame_count=len(frames),
        exptime_s=next(iter(exptimes)) if len(exptimes) == 1 else None,
        report=report,
        siril_stack=_stack_of(run, "siril"),
        seestar_stack=_stack_of(run, "seestar"),
        selection_kept=chosen.kept if chosen else None)


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


def _chosen(run: ProcessingRun, options: list[SelectionOption]) -> SelectionOption | None:
    chosen = (run.choices or {}).get("selection")
    return next((o for o in options if o.id == chosen), None)


def _scripts(facts: Facts, chosen: SelectionOption | None) -> dict[str, Any]:
    """Disk each script will write, shown before the download. Before frames are chosen the stack script's share
    is only known as an upper bound: an aligned copy of every frame."""
    return {"prepare_bytes": disk_estimate_bytes(facts.frame_count),
            "stack_max_bytes": disk_estimate_bytes(facts.frame_count),
            "stack_bytes": disk_estimate_bytes(chosen.kept) if chosen else None,
            "stack_blocked": None if chosen else NO_SELECTION}


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


def _image_url(run: ProcessingRun, key: str) -> str:
    return f"/api/processing/runs/{run.id}/images/{key}"


def comparison_out(db: Session, run: ProcessingRun, lt: LibraryTarget) -> dict[str, Any]:
    """What the Compare step shows. Storage keys never leave the server: previews are addressed by URL.
    ``mode_available`` says when both sides of a mode exist (the step is usable either way: a missing side
    is shown as an empty state with its own Add button)."""
    stored = run.comparison or {}
    pic = stored.get("seestar_picture") if isinstance(stored.get("seestar_picture"), dict) else None
    seestar_picture = None
    if pic:
        seestar_picture = {"preview_url": _image_url(run, pic["preview_key"]), "source_filename": pic["source_filename"],
                           "width": pic["width"], "height": pic["height"],
                           "edited": pic.get("edited"), "edited_by": pic.get("edited_by")}
    img = db.scalars(select(FinalImage).where(FinalImage.library_target_id == lt.id, FinalImage.is_current.is_(True))).first()
    final_picture = None
    if img:
        final_picture = {"id": img.id, "source_filename": img.source_filename, "format": img.format,
                         "width": img.width, "height": img.height,
                         "preview_url": f"/api/astrolog/images/{img.id}/preview"}

    def stack(side: str) -> dict[str, Any] | None:
        e = stored.get(side + "_stack")
        if not isinstance(e, dict):
            return None
        return {"preview_url": _image_url(run, e["preview_key"]), "measurement": e["measurement"],
                "source_filename": e["source_filename"]}

    siril, seestar = stack("siril"), stack("seestar")
    return {"mode_available": {"pictures": bool(seestar_picture and final_picture), "stacks": bool(siril and seestar)},
            "seestar_picture": seestar_picture, "final_picture": final_picture,
            "siril_stack": siril, "seestar_stack": seestar}


def run_out(db: Session, run: ProcessingRun) -> dict[str, Any]:
    cs = db.get(CaptureSet, run.capture_set_id)
    lt = db.get(LibraryTarget, cs.library_target_id)
    sess = db.get(ObservingSession, cs.session_id)
    loc = db.get(ObservingLocation, sess.location_id) if sess.location_id else None
    frames = _frames(db, cs)
    report = _report(run, frames, lt, loc)
    options = _options(run, frames, report)
    chosen = _chosen(run, options)
    facts = _facts(frames, report, chosen, run)
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
        "selection": [asdict(o) for o in options],
        "selection_last_time": asdict(last) if (last := _last_time(db, run, cs)) else None,
        "choices": {k: v for k, v in (run.choices or {}).items() if k in CHOICE_KEYS},
        "comparison": comparison_out(db, run, lt),  # the only public shape; stored keys stay server-side
        "siril_target": SIRIL_TARGET,
        "scripts": _scripts(facts, chosen),
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
    if body.comparison is not None:
        edit = body.comparison.get("seestar_picture")
        if set(body.comparison) != {"seestar_picture"} or not isinstance(edit, dict) or set(edit) != {"edited"} \
                or not (edit["edited"] is None or isinstance(edit["edited"], bool)):
            raise HTTPException(422, 'Only {"seestar_picture": {"edited": true | false | null}} can be set')
        pic = (run.comparison or {}).get("seestar_picture")
        if not isinstance(pic, dict):
            raise HTTPException(409, "Add the Seestar picture first.")
        run.comparison = {**(run.comparison or {}), "seestar_picture": {**pic, "edited": edit["edited"]}}
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


@router.get("/runs/{run_id}/scripts/{which}", response_class=PlainTextResponse)
def get_script(run_id: str, which: str, db: Session = Depends(get_db)) -> PlainTextResponse:
    """One of the two generated Siril scripts (``prepare`` or ``stack``), as a download named
    astroplanner-<which>.ssf."""
    if which not in SCRIPT_NAMES:
        raise HTTPException(404, "No such script")
    run = _get_run(db, run_id)
    cs = db.get(CaptureSet, run.capture_set_id)
    sess = db.get(ObservingSession, cs.session_id)
    loc = db.get(ObservingLocation, sess.location_id) if sess.location_id else None
    frames = _frames(db, cs)
    report = _report(run, frames, db.get(LibraryTarget, cs.library_target_id), loc)
    chosen = _chosen(run, _options(run, frames, report))
    facts = _facts(frames, report, chosen)
    if which == "prepare":
        text = prepare_script(facts)
    else:
        if chosen is None:
            raise HTTPException(409, NO_SELECTION)
        text = stack_script(chosen, facts)
    return PlainTextResponse(text, media_type="text/plain; charset=utf-8", headers={
        "Content-Disposition": f'attachment; filename="{SCRIPT_NAMES[which]}"'})


def _finite(m: StackMeasurement) -> bool:
    vals = [v for k, v in asdict(m).items() if isinstance(v, float)]
    ratio = m.bg_rgb_ratio or ()
    return all(math.isfinite(v) for v in [*vals, *ratio])


@router.post("/runs/{run_id}/stacks/{side}")
async def upload_stack(run_id: str, side: str, request: Request, file: UploadFile = File(...),
                       db: Session = Depends(get_db)) -> dict[str, Any]:
    """Measure one finished stack (``siril`` or ``seestar``) in memory. The FITS is not stored: only its numbers
    and two metadata-free JPEGs are. Uploading again replaces the previous stack for that side."""
    if side not in STACK_SIDES:
        raise HTTPException(404, "No such stack")
    run = _get_run(db, run_id)
    limit: int = request.app.state.max_upload_bytes
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit + 64 * 1024:
        raise HTTPException(413, f"File is too large; the limit is {limit // (1024 * 1024)} MB.")
    name = PurePosixPath((file.filename or "").replace("\\", "/")).name[:512]
    if "." + previews.format_of(name) not in previews.FITS_EXT:
        raise HTTPException(422, "Stacks must be FITS files")
    data = await _read_limited(file, limit)
    try:
        m, preview, thumb = measure_stack(data, name)
    except previews.ImageTooLarge as exc:
        raise HTTPException(413, str(exc)) from exc
    except (previews.UnsupportedImage, UnmeasurableStack) as exc:
        raise HTTPException(422, str(exc)) from exc
    if not _finite(m):
        raise HTTPException(422, "The stack could not be measured: a measurement was not a finite number.")
    storage = request.app.state.storage
    token = uuid.uuid4().hex[:12]
    keys = {"preview_key": f"processing/{run.id}/{side}-{token}-preview.jpg",
            "thumb_key": f"processing/{run.id}/{side}-{token}-thumb.jpg"}
    old = (run.comparison or {}).get(side + "_stack") or {}
    try:
        storage.put(keys["preview_key"], preview, "image/jpeg")
        storage.put(keys["thumb_key"], thumb, "image/jpeg")
        run.comparison = {**(run.comparison or {}), side + "_stack": {
            "measurement": asdict(m), **keys, "source_filename": name}}  # new dict: JSON columns aren't tracked
        run.updated_at = _utcnow()
        db.commit()
    except Exception:
        db.rollback()
        for k in keys.values():
            storage.delete(k)
        raise
    for k in ("preview_key", "thumb_key"):
        if old.get(k):
            storage.delete(old[k])
    return run_out(db, run)


@router.get("/runs/{run_id}/images/{key:path}")
def get_stack_image(run_id: str, key: str, request: Request, db: Session = Depends(get_db)) -> Response:
    """A stored stack preview or thumbnail; only keys this run's comparison lists are served."""
    run = _get_run(db, run_id)
    listed = {e.get(k) for e in (run.comparison or {}).values() if isinstance(e, dict)
              for k in ("preview_key", "thumb_key")}
    if key not in listed:
        raise HTTPException(404, "Image not found")
    try:
        body = request.app.state.storage.get(key)
    except KeyError:
        raise HTTPException(404, "Image file is missing") from None
    return Response(body, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600",
                                                            "X-Content-Type-Options": "nosniff"})


SOFTWARE_TAG = 305  # EXIF/TIFF "Software"
MAX_SOFTWARE_CHARS = 200


def _software(data: bytes) -> str | None:
    """The editing program a picture says it was saved by (EXIF Software), else None. Read from a copy of the
    bytes; nothing else from the metadata is looked at and none of it reaches the stored previews."""
    try:
        with Image.open(io.BytesIO(data)) as im:
            value = im.getexif().get(SOFTWARE_TAG)
    except Exception:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8", "ignore")
    if not isinstance(value, str):
        return None
    value = "".join(ch for ch in value if ch.isprintable()).strip()
    return value[:MAX_SOFTWARE_CHARS] or None


@router.post("/runs/{run_id}/pictures/seestar")
async def upload_seestar_picture(run_id: str, request: Request, file: UploadFile = File(...),
                                 db: Session = Depends(get_db)) -> dict[str, Any]:
    """The Seestar's own final picture (JPEG, PNG or TIFF). Only two metadata-free previews are kept; ``edited``
    is True when the file names an editing program (EXIF Software), otherwise unknown (None) until the user says."""
    run = _get_run(db, run_id)
    limit: int = request.app.state.max_upload_bytes
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit + 64 * 1024:
        raise HTTPException(413, f"File is too large; the limit is {limit // (1024 * 1024)} MB.")
    name = PurePosixPath((file.filename or "").replace("\\", "/")).name[:512]
    if "." + previews.format_of(name) not in previews.PILLOW_EXT | previews.TIFF_EXT:
        raise HTTPException(422, "The Seestar picture must be a JPEG, PNG or TIFF file.")
    data = await _read_limited(file, limit)
    try:
        preview, thumb, w, h, _fmt = previews.make_previews(data, name)
    except previews.ImageTooLarge as exc:
        raise HTTPException(413, str(exc)) from exc
    except previews.UnsupportedImage as exc:
        raise HTTPException(422, str(exc)) from exc
    software = _software(data)
    storage = request.app.state.storage
    token = uuid.uuid4().hex[:12]
    keys = {"preview_key": f"processing/{run.id}/picture-{token}-preview.jpg",
            "thumb_key": f"processing/{run.id}/picture-{token}-thumb.jpg"}
    old = (run.comparison or {}).get("seestar_picture") or {}
    try:
        storage.put(keys["preview_key"], preview, "image/jpeg")
        storage.put(keys["thumb_key"], thumb, "image/jpeg")
        run.comparison = {**(run.comparison or {}), "seestar_picture": {
            **keys, "source_filename": name, "width": w, "height": h,
            "edited": True if software else None, "edited_by": software}}
        run.updated_at = _utcnow()
        db.commit()
    except Exception:
        db.rollback()
        for k in keys.values():
            storage.delete(k)
        raise
    for k in ("preview_key", "thumb_key"):
        if old.get(k):
            storage.delete(old[k])
    return run_out(db, run)
