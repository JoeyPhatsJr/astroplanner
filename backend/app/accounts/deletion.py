"""Delete an account: the user, their sign-in sessions and every row they own, in dependency order.

Foreign keys stay RESTRICT, so the order is spelled out here instead of relying on ``ON DELETE`` actions. The only
database cascades used are ``session_targets`` going with their ``sessions`` and a capture set's ``equipment_id``
clearing (SET NULL) when its profile goes. The user's own places and equipment go after their plans and nights.
Sample places, preset equipment, other users' rows and ``app_meta`` (including ``accounts_claimed``, so the
first-account claim never runs again) are not touched, with one exception: a plan of another account that still
names one of the deleted places or profiles (possible only for plans made before places became private) loses
that reference instead of blocking the deletion. Original files on the user's computer are never involved: only
the stored previews are removed.
"""

from __future__ import annotations

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.astrolog.models import CaptureFrame, CaptureSet, FinalImage, LibraryTarget, Stack
from app.db import EquipmentProfile, ObservingLocation, ObservingSession
from app.processing.models import ProcessingRun, comparison_keys

from .models import User, UserSession


def delete_account(db: Session, user: User) -> list[str]:
    """Delete ``user`` and everything they own; return the storage keys of their preview files.

    Runs in the caller's transaction. The caller commits, *then* deletes the returned keys, so a failed commit
    never leaves rows pointing at removed files. A key whose file is already missing is not an error.
    """
    uid = user.id
    keys: set[str] = set()
    for run in db.scalars(select(ProcessingRun).where(ProcessingRun.owner_id == uid)):
        keys |= comparison_keys(run)  # the same set the run's image route serves
    for preview_key, thumb_key in db.execute(
            select(FinalImage.preview_key, FinalImage.thumb_key).where(FinalImage.owner_id == uid)):
        keys.update(k for k in (preview_key, thumb_key) if k)

    # Children before parents, against the FKs: runs -> capture_sets; final_images -> library_targets (and
    # stacks); stacks -> library_targets; frames -> capture_sets; capture_sets -> sessions and library_targets.
    for model in (ProcessingRun, FinalImage, Stack, CaptureFrame, CaptureSet,
                  ObservingSession,  # its session_targets go by the database's ON DELETE CASCADE
                  LibraryTarget):
        db.execute(delete(model).where(model.owner_id == uid).execution_options(synchronize_session=False))
    # Places and equipment last: sessions (RESTRICT) reference them. The user's own sessions are gone by now.
    for model, column in ((ObservingLocation, ObservingSession.location_id),
                          (EquipmentProfile, ObservingSession.equipment_id)):
        owned = select(model.id).where(model.owner_id == uid).scalar_subquery()
        db.execute(update(ObservingSession).where(column.in_(owned)).values({column.key: None})
                   .execution_options(synchronize_session=False))
        db.execute(delete(model).where(model.owner_id == uid).execution_options(synchronize_session=False))
    db.execute(delete(UserSession).where(UserSession.user_id == uid).execution_options(synchronize_session=False))
    db.execute(delete(User).where(User.id == uid).execution_options(synchronize_session=False))
    return sorted(keys)
