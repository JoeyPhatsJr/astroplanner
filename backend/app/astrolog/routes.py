"""AstroLog HTTP routes (thin): /api/astrolog/import/{preview,commit,suggest-location}.

Bodies are validated by hand so that a 422 never echoes the request back: the default FastAPI
error includes the offending ``input``, which here would be base64 header bytes (and therefore
the header coordinates).
"""

from __future__ import annotations

from typing import Any, Literal, TypeVar

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api import get_db
from app.db import ObservingLocation

from . import importer
from .models import CaptureFrame, Stack

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
                                        unsorted_groups=req.unsorted_groups)
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
