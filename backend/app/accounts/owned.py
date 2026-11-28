"""Owned rows: the tables that carry ``owner_id``, the owner-checked lookups, and the one-time claim.

Rows written before accounts have a NULL owner. The first account created on an install takes all of them over,
once; ``AppMeta("accounts_claimed")`` records that the claim ran (even when there was nothing to claim), so no
later account ever sees them.

Places and equipment (migration 0008_private_places) have shared rows as well: sample places and preset equipment
are ownerless on purpose, readable by everyone and changed by no one. Every other place or profile is private to
its owner. Visibility is decided by the sample/preset flag, never by a NULL owner: an unclaimed legacy row is
ownerless too, and it is shown to no one.
"""

from __future__ import annotations

from typing import TypeVar

from fastapi import HTTPException
from sqlalchemy import ColumnElement, false, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.astrolog.models import CaptureFrame, CaptureSet, FinalImage, LibraryTarget, Stack
from app.db import AppMeta, EquipmentProfile, ObservingLocation, ObservingSession
from app.processing.models import ProcessingRun

from .models import User

OWNED_MODELS = (ObservingSession, LibraryTarget, CaptureSet, CaptureFrame, Stack, FinalImage, ProcessingRun)
# Owned settings rows, each with the flag that marks its shared rows (never claimed, never owned).
SETTINGS_MODELS = ((ObservingLocation, ObservingLocation.is_sample), (EquipmentProfile, EquipmentProfile.is_preset))
CLAIM_KEY = "accounts_claimed"

SAMPLE_READ_ONLY = "Sample places can't be changed. Add your own place instead."
PRESET_READ_ONLY = "Built-in presets are read-only. Duplicate it to make a custom profile."
LOCATION_NOT_FOUND = "Location not found"
EQUIPMENT_NOT_FOUND = "Equipment profile not found"

T = TypeVar("T")


def get_owned(db: Session, model: type[T], row_id: str, user: User, detail: str) -> T:
    """The ``model`` row ``row_id`` if ``user`` owns it; otherwise the same 404 as a missing row (never a 403)."""
    row = db.get(model, row_id)
    if row is None or row.owner_id != user.id:  # type: ignore[attr-defined]
        raise HTTPException(404, detail)
    return row


def visible_locations(user: User | None) -> ColumnElement[bool]:
    """WHERE clause: the sample places, plus ``user``'s own places when signed in."""
    if user is None:
        return ObservingLocation.is_sample.is_(True)
    return ObservingLocation.is_sample.is_(True) | (ObservingLocation.owner_id == user.id)


def visible_equipment(user: User | None) -> ColumnElement[bool]:
    """WHERE clause: the preset profiles, plus ``user``'s own profiles when signed in."""
    if user is None:
        return EquipmentProfile.is_preset.is_(True)
    return EquipmentProfile.is_preset.is_(True) | (EquipmentProfile.owner_id == user.id)


def _visible(row, shared: bool, user: User | None) -> bool:
    return row is not None and (shared or (user is not None and row.owner_id == user.id))


def get_visible_location(db: Session, location_id: str, user: User | None,
                         detail: str = LOCATION_NOT_FOUND) -> ObservingLocation:
    """A sample place or ``user``'s own; anyone else's answers the same 404 as a missing one."""
    loc = db.get(ObservingLocation, location_id)
    if not _visible(loc, bool(loc and loc.is_sample), user):
        raise HTTPException(404, detail)
    return loc  # type: ignore[return-value]


def get_visible_equipment(db: Session, equipment_id: str, user: User | None,
                          detail: str = EQUIPMENT_NOT_FOUND) -> EquipmentProfile:
    """A preset profile or ``user``'s own; anyone else's answers the same 404 as a missing one."""
    eq = db.get(EquipmentProfile, equipment_id)
    if not _visible(eq, bool(eq and eq.is_preset), user):
        raise HTTPException(404, detail)
    return eq  # type: ignore[return-value]


def get_own_location(db: Session, location_id: str, user: User) -> ObservingLocation:
    """For a change: ``user``'s own place. A sample is 403 (it is visible, just read-only); anything else 404."""
    loc = get_visible_location(db, location_id, user)
    if loc.is_sample:
        raise HTTPException(403, SAMPLE_READ_ONLY)
    return loc


def get_own_equipment(db: Session, equipment_id: str, user: User) -> EquipmentProfile:
    """For a change: ``user``'s own profile. A preset is 403 (visible, read-only); anything else 404."""
    eq = get_visible_equipment(db, equipment_id, user)
    if eq.is_preset:
        raise HTTPException(403, PRESET_READ_ONLY)
    return eq


def claim_unowned(db: Session, user: User) -> bool:
    """Give ``user`` every ownerless row if no account has claimed them yet. Returns False if a claim already ran.

    Runs inside the caller's transaction (sign-up), after ``user`` is flushed: ``owner_id`` references it. The
    flag goes in first under a savepoint, so a second, concurrent first sign-up fails on its primary key and
    claims nothing. Sample places and preset equipment are never claimed: they stay shared.

    Sets ``user.claimed_existing`` when any plan, night or AstroLog / coach row was taken over (the account page
    says "your existing plans and AstroLog library were added"). Places and equipment are claimed without
    counting: a fresh install seeds an editable Canon profile, which is not the user's earlier work.
    """
    try:
        with db.begin_nested():
            db.add(AppMeta(key=CLAIM_KEY, value=user.id))
            db.flush()
    except IntegrityError:
        return False
    updated = 0
    for model in OWNED_MODELS:
        result = db.execute(update(model).where(model.owner_id.is_(None)).values(owner_id=user.id)
                            .execution_options(synchronize_session=False))
        updated += result.rowcount or 0
    for model, shared_flag in SETTINGS_MODELS:
        db.execute(update(model).where(model.owner_id.is_(None), shared_flag == false()).values(owner_id=user.id)
                   .execution_options(synchronize_session=False))
    user.claimed_existing = updated > 0
    return True
