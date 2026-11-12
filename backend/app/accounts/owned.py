"""Owned rows: the tables that carry ``owner_id``, and the one-time claim of rows from before accounts.

Rows written before accounts have a NULL owner. The first account created on an install takes all of them over,
once; ``AppMeta("accounts_claimed")`` records that the claim ran (even when there was nothing to claim), so no
later account ever sees them.
"""

from __future__ import annotations

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.astrolog.models import CaptureFrame, CaptureSet, FinalImage, LibraryTarget, Stack
from app.db import AppMeta, ObservingSession
from app.processing.models import ProcessingRun

from .models import User

OWNED_MODELS = (ObservingSession, LibraryTarget, CaptureSet, CaptureFrame, Stack, FinalImage, ProcessingRun)
CLAIM_KEY = "accounts_claimed"


def claim_unowned(db: Session, user: User) -> bool:
    """Give ``user`` every ownerless row if no account has claimed them yet. Returns False if a claim already ran.

    Runs inside the caller's transaction (sign-up), after ``user`` is flushed: ``owner_id`` references it. The
    flag goes in first under a savepoint, so a second, concurrent first sign-up fails on its primary key and
    claims nothing. Sets ``user.claimed_existing`` when any row was taken over.
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
    user.claimed_existing = updated > 0
    return True
