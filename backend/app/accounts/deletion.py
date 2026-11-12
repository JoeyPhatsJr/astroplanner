"""Delete an account: the user, their sign-in sessions and every row they own, in dependency order.

Foreign keys stay RESTRICT, so the order is spelled out here instead of relying on ``ON DELETE`` actions. The only
database cascade used is ``session_targets`` going with their ``sessions``. Shared places and equipment, other
users' rows and ``app_meta`` (including ``accounts_claimed``, so the first-account claim never runs again) are not
touched. Original files on the user's computer are never involved: only the stored previews are removed.
"""

from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.astrolog.models import CaptureFrame, CaptureSet, FinalImage, LibraryTarget, Stack
from app.db import ObservingSession
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
    db.execute(delete(UserSession).where(UserSession.user_id == uid).execution_options(synchronize_session=False))
    db.execute(delete(User).where(User.id == uid).execution_options(synchronize_session=False))
    return sorted(keys)
