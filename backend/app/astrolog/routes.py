"""AstroLog HTTP routes (thin): /api/astrolog/import/{preview,commit,suggest-location}.

Bodies are validated by hand so that a 422 never echoes the request back: the default FastAPI
error includes the offending ``input``, which here would be base64 header bytes (and therefore
the header coordinates).
"""

from __future__ import annotations

from pathlib import PurePosixPath
from typing import Any, Literal, TypeVar

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api import get_db
from app.db import ObservingLocation

from . import importer, library, previews
from .models import CaptureFrame, FinalImage, LibraryTarget, Stack

router = APIRouter(prefix="/api/astrolog", tags=["astrolog"])

MAX_ITEMS = 300
MAX_HEADER_B64 = 180_000  # CR2 slice 131072 bytes -> 174764 base64 chars; FITS is far smaller


class ImportItem(BaseModel):
    path: str = Field(..., min_length=1, max_length=1024)
    kind: Literal["fits", "cr2"]
    header_b64: str = Field(..., max_length=MAX_HEADER_B64)
    size: int = Field(0, ge=0)


class PreviewIn(BaseModel):
    items: list[ImportItem] = Field(..., max_length=MAX_ITEMS)
    location_id: str | None = None
    clock_offset_minutes: int = Field(0, ge=-1440, le=1440)


class CommitIn(PreviewIn):
    plan_session_id: str | None = None
    plan_choices: dict[str, str] = Field(default_factory=dict, max_length=MAX_ITEMS)
    canon_set_names: dict[str, str] = Field(default_factory=dict)
    unsorted_groups: list[str] = Field(default_factory=list, max_length=MAX_ITEMS)


class SuggestIn(BaseModel):
    items: list[ImportItem] = Field(..., max_length=MAX_ITEMS)


M = TypeVar("M", bound=BaseModel)


def _validate(model: type[M], body: Any) -> M:
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        raise HTTPException(422, [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]}
                                  for e in exc.errors(include_input=False, include_url=False)])


def _location(db: Session, location_id: str | None) -> ObservingLocation | None:
    if location_id is None:
        return None
    loc = db.get(ObservingLocation, location_id)
    if loc is None:
        raise HTTPException(422, "location_id does not exist")
    return loc


@router.post("/import/preview")
def import_preview(body: Any = Body(...), db: Session = Depends(get_db)) -> dict[str, Any]:
    req = _validate(PreviewIn, body)
    parsed, skipped = importer.parse_items(req.items)
    loc = _location(db, req.location_id)
    candidates: list[dict[str, Any]] = []
    if loc is None:
        loc, candidates = importer.resolve_batch_location(parsed, list(db.scalars(select(ObservingLocation))))
    groups = importer.group_items(parsed, loc, req.clock_offset_minutes)
    stacks = importer.stack_infos(parsed, loc)
    known = importer.existing_keys(db, CaptureFrame, (f.dedup_key for g in groups for f in g.frames))
    known_stacks = importer.existing_keys(db, Stack, (s.dedup_key for s in stacks))
    loc_id = loc.id if loc else None

    def group_out(g: importer.Group) -> dict[str, Any]:
        new = {f.dedup_key for f in g.frames} - known
        return {**g.summary(), "new_frames": len(new), "plan_session_ids": importer.plan_ids_for(db, g.night_date, loc_id)}

    return {
        "needs_location": loc is None and bool(parsed),
        "location_id": loc_id,
        "location_candidates": candidates,
        "groups": [group_out(g) for g in groups],
        "stacks": [{**s.out(), "new": s.dedup_key not in known_stacks} for s in stacks],
        "skipped": skipped,
    }


@router.post("/import/commit")
def import_commit(body: Any = Body(...), db: Session = Depends(get_db)) -> dict[str, Any]:
    req = _validate(CommitIn, body)
    if not req.location_id:
        raise HTTPException(422, "location_id is required: choose the saved location these files were taken at.")
    loc = _location(db, req.location_id)
    names = req.canon_set_names  # {group_key: name}
    if any(len(v) > 160 for v in names.values()):
        raise HTTPException(422, "Canon set names must be at most 160 characters")
    parsed, skipped = importer.parse_items(req.items)
    try:
        result = importer.commit_import(db, parsed, loc, clock_offset_minutes=req.clock_offset_minutes,
                                        plan_session_id=req.plan_session_id, canon_set_names=names,
                                        unsorted_groups=req.unsorted_groups, plan_choices=req.plan_choices)
        db.commit()
    except importer.ImportRequestError as exc:
        db.rollback()
        raise HTTPException(422, str(exc))
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Another import changed these records at the same time; run the import again.")
    return {**result, "skipped": skipped}


@router.post("/import/suggest-location")
def import_suggest_location(body: Any = Body(...)) -> dict[str, Any]:
    req = _validate(SuggestIn, body)
    parsed, _ = importer.parse_items(req.items)
    out = importer.suggest_location(parsed)
    if out is None:
        raise HTTPException(422, "These files contain no site coordinates.")
    return out


# ---- final pictures -------------------------------------------------------------------------

class StackLinkIn(BaseModel):
    final_image_id: str = Field(..., max_length=64)
    stack_id: str | None = Field(None, max_length=64)


def _image_out(img: FinalImage) -> dict[str, Any]:
    return {"id": img.id, "library_target_id": img.library_target_id, "stack_id": img.stack_id,
            "source_filename": img.source_filename, "format": img.format, "width": img.width,
            "height": img.height, "is_current": img.is_current, "chosen_at": img.chosen_at}


async def _read_limited(file: UploadFile, limit: int) -> bytes:
    mb = limit // (1024 * 1024) if limit >= 1024 * 1024 else limit / (1024 * 1024)
    msg = f"File is too large; the limit is {mb:g} MB."
    chunks, total = [], 0
    while chunk := await file.read(1024 * 1024):
        total += len(chunk)
        if total > limit:
            raise HTTPException(413, msg)
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/targets/{library_target_id}/final-image")
async def upload_final_image(library_target_id: str, request: Request, file: UploadFile = File(...),
                             stack_id: str | None = Form(None), db: Session = Depends(get_db)) -> dict[str, Any]:
    limit: int = request.app.state.max_upload_bytes
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit + 64 * 1024:
        raise HTTPException(413, f"File is too large; the limit is {limit // (1024 * 1024)} MB.")
    if db.get(LibraryTarget, library_target_id) is None:
        raise HTTPException(404, "Target not found")
    name = PurePosixPath((file.filename or "").replace("\\", "/")).name[:512]
    if "." + previews.format_of(name) not in previews.SUPPORTED_EXT:
        raise HTTPException(415, "Unsupported file type. Use JPEG, PNG, TIFF or FITS.")
    if stack_id is not None:
        st = db.get(Stack, stack_id)
        if st is None or st.library_target_id != library_target_id:
            raise HTTPException(422, "stack_id does not belong to this target")
    data = await _read_limited(file, limit)
    try:
        preview, thumb, w, h, fmt = previews.make_previews(data, name)
    except previews.UnsupportedImage as exc:
        raise HTTPException(415, str(exc))
    except previews.ImageTooLarge as exc:
        raise HTTPException(413, str(exc))
    storage = request.app.state.storage
    img = FinalImage(library_target_id=library_target_id, stack_id=stack_id, source_filename=name,
                     format=fmt, preview_key="", thumb_key="", width=w, height=h,
                     is_current=True)
    db.add(img)
    db.flush()
    img.preview_key, img.thumb_key = f"{img.id}/preview.jpg", f"{img.id}/thumb.jpg"
    try:
        storage.put(img.preview_key, preview, "image/jpeg")
        storage.put(img.thumb_key, thumb, "image/jpeg")
        for old in db.scalars(select(FinalImage).where(FinalImage.library_target_id == library_target_id,
                                                       FinalImage.id != img.id, FinalImage.is_current.is_(True))):
            old.is_current = False
        db.commit()
    except Exception:
        db.rollback()
        storage.delete(img.preview_key)
        storage.delete(img.thumb_key)
        raise
    return _image_out(img)


def _serve(request: Request, db: Session, image_id: str, which: str) -> Response:
    img = db.get(FinalImage, image_id)
    if img is None:
        raise HTTPException(404, "Image not found")
    try:
        data = request.app.state.storage.get(img.preview_key if which == "preview" else img.thumb_key)
    except KeyError:
        raise HTTPException(404, "Image file is missing")
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600",
                                                                  "X-Content-Type-Options": "nosniff"})


@router.get("/images/{final_image_id}/preview")
def image_preview(final_image_id: str, request: Request, db: Session = Depends(get_db)) -> Response:
    return _serve(request, db, final_image_id, "preview")


@router.get("/images/{final_image_id}/thumb")
def image_thumb(final_image_id: str, request: Request, db: Session = Depends(get_db)) -> Response:
    return _serve(request, db, final_image_id, "thumb")


@router.post("/targets/{library_target_id}/stack-link")
def stack_link(library_target_id: str, body: Any = Body(...), db: Session = Depends(get_db)) -> dict[str, Any]:
    req = _validate(StackLinkIn, body)
    img = db.get(FinalImage, req.final_image_id)
    if img is None or img.library_target_id != library_target_id:
        raise HTTPException(404, "Final image not found for this target")
    if req.stack_id is not None:
        st = db.get(Stack, req.stack_id)
        if st is None or st.library_target_id != library_target_id:
            raise HTTPException(404, "Stack not found for this target")
    img.stack_id = req.stack_id
    db.commit()
    return _image_out(img)


# ---- library, target page, history ----------------------------------------------------------

class TargetPatch(BaseModel):
    custom_name: str | None = Field(None, min_length=1, max_length=160)
    kind: Literal["custom", "unsorted"] | None = None


@router.get("/library")
def get_library(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return library.library(db)


@router.get("/history")
def get_history(db: Session = Depends(get_db)) -> dict[str, dict[str, Any]]:
    return library.history(db)


def _library_target(db: Session, library_target_id: str) -> LibraryTarget:
    lt = db.get(LibraryTarget, library_target_id)
    if lt is None:
        raise HTTPException(404, "Target not found")
    return lt


@router.get("/targets/{library_target_id}")
def get_target_page(library_target_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    return library.target_page(db, _library_target(db, library_target_id))


@router.patch("/targets/{library_target_id}")
def patch_target(library_target_id: str, body: Any = Body(...), db: Session = Depends(get_db)) -> dict[str, Any]:
    req = _validate(TargetPatch, body)
    lt = _library_target(db, library_target_id)
    if lt.kind == "catalog":
        raise HTTPException(403, "Catalog targets cannot be renamed or moved.")
    if library.is_canonical_unsorted(lt):
        raise HTTPException(409, "The Unsorted group can't be renamed.")
    data = req.model_dump(exclude_unset=True)
    if data.get("kind") == "unsorted":
        # One Unsorted group: merge into it rather than relabel (never two "Unsorted" tiles).
        dest = library.merge_into_unsorted(db, lt)
        db.commit()
        return library.target_page(db, dest)
    if data.get("custom_name") is not None:
        lt.custom_name = data["custom_name"].strip() or lt.custom_name
    if data.get("kind") is not None:
        lt.kind = data["kind"]
    db.commit()
    return library.target_page(db, lt)
