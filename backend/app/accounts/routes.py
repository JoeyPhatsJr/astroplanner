"""Auth routes: /api/auth/{signup,login,logout,me,password,delete}.

Bodies are validated with ``validate_body`` so a 422 never echoes a password back. Sign-in failures read
the same for an unknown email and a wrong password, and an unknown email still runs a hash verification.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.deps import get_db, validate_body

from .core import (DUMMY_HASH, AccountInputError, check_password, create_session, hash_password, iso_utc,
                   normalize_email, revoke_other_sessions, revoke_session, verify_password)
from .deletion import delete_account
from .deps import COOKIE_NAME, clear_session_cookie, current_user, set_session_cookie
from .models import User
from .owned import claim_unowned

router = APIRouter(prefix="/api/auth", tags=["auth"])
log = logging.getLogger(__name__)

SIGN_IN_FAILED = "That email and password don’t match. Check them, or reset your password."
TRY_LATER = " Try again in a few minutes."
SIGNUP_THROTTLED = "Too many attempts from here. Try again in a few minutes."
EMAIL_TAKEN = "An account with this email already exists. Sign in instead."
WRONG_PASSWORD = "That password isn’t right."
CONFIRM_DELETE = "Type DELETE to confirm."

# A generous bound only on strings that reach Argon2 before any rule check, so a huge one is refused
# before hashing. Sign-up and the new password are checked in code first, which keeps their exact copy.
_RAW = 4096


class SignupIn(BaseModel):
    email: str
    password: str


class LoginIn(BaseModel):
    email: str = Field(..., max_length=_RAW)
    password: str = Field(..., max_length=_RAW)


class PasswordChange(BaseModel):
    current_password: str = Field(..., max_length=_RAW)
    new_password: str


class DeleteIn(BaseModel):
    password: str = Field(..., max_length=_RAW)
    confirm: str  # checked in code, so a mistype gets the exact copy instead of a validation list


def me_out(user: User) -> dict[str, Any]:
    return {"email": user.email, "created_at": user.created_at, "claimed_existing": bool(user.claimed_existing)}


def _client_key(request: Request) -> str:
    return f"signup:{request.client.host if request.client else 'unknown'}"


@router.post("/signup", status_code=201)
def signup(request: Request, response: Response, body: Any = Body(...),
           db: Session = Depends(get_db)) -> dict[str, Any]:
    req = validate_body(SignupIn, body)
    throttle = request.app.state.signup_throttle
    key = _client_key(request)
    # Atomic check-and-count: the attempt is reserved now and released unless it ends in a 409, since
    # only an existing email counts (that is how addresses would be probed).
    if not throttle.try_acquire(key):
        raise HTTPException(429, SIGNUP_THROTTLED)
    try:
        email = normalize_email(req.email)
        check_password(req.password)
    except AccountInputError as exc:
        throttle.release(key)
        raise HTTPException(422, exc.message)
    if db.scalar(select(User.id).where(User.email == email)) is not None:
        raise HTTPException(409, EMAIL_TAKEN)
    now = request.app.state.clock()
    user = User(email=email, password_hash=hash_password(req.password), created_at=iso_utc(now))
    db.add(user)
    try:
        db.flush()
    except IntegrityError:  # the same email signed up a moment ago
        db.rollback()
        raise HTTPException(409, EMAIL_TAKEN)
    claim_unowned(db, user)  # the first account on an install takes over the rows from before accounts
    token = create_session(db, user, now)
    db.commit()
    throttle.release(key)
    set_session_cookie(response, request, token)
    return me_out(user)


@router.post("/login")
def login(request: Request, response: Response, body: Any = Body(...),
          db: Session = Depends(get_db)) -> dict[str, Any]:
    req = validate_body(LoginIn, body)
    email = req.email.strip().lower()  # no format check: a malformed email simply matches no account
    throttle = request.app.state.login_throttle
    key = f"email:{email}"
    if not throttle.try_acquire(key):  # atomic: refuses when locked, else counts this attempt up front
        raise HTTPException(429, SIGN_IN_FAILED + TRY_LATER)
    user = db.scalar(select(User).where(User.email == email))
    ok = verify_password(user.password_hash if user else DUMMY_HASH, req.password)
    if user is None or not ok:
        raise HTTPException(401, SIGN_IN_FAILED)  # already counted by try_acquire
    throttle.clear(key)
    token = create_session(db, user, request.app.state.clock())
    db.commit()
    set_session_cookie(response, request, token)
    return me_out(user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> None:
    revoke_session(db, request.cookies.get(COOKIE_NAME))
    db.commit()
    clear_session_cookie(response)


@router.get("/me")
def me(user: User = Depends(current_user)) -> dict[str, Any]:
    return me_out(user)


@router.post("/password", status_code=204)
def change_password(request: Request, body: Any = Body(...), user: User = Depends(current_user),
                    db: Session = Depends(get_db)) -> None:
    req = validate_body(PasswordChange, body)
    # A session holder must not be able to brute-force the current password (and then lock the owner out).
    throttle = request.app.state.login_throttle
    key = f"user:{user.id}"
    if not throttle.try_acquire(key):
        raise HTTPException(429, WRONG_PASSWORD + TRY_LATER)
    if not verify_password(user.password_hash, req.current_password):
        raise HTTPException(400, WRONG_PASSWORD)  # already counted by try_acquire
    throttle.clear(key)
    try:
        check_password(req.new_password)
    except AccountInputError as exc:
        raise HTTPException(422, exc.message)
    user.password_hash = hash_password(req.new_password)
    revoke_other_sessions(db, user.id, keep_token=request.cookies.get(COOKIE_NAME))
    db.commit()


@router.post("/delete", status_code=204)
def delete_own_account(request: Request, response: Response, body: Any = Body(...),
                       user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    """Delete the signed-in account and everything it owns, then its preview files, and sign out."""
    req = validate_body(DeleteIn, body)
    if req.confirm != "DELETE":
        raise HTTPException(422, CONFIRM_DELETE)  # before the throttle: a mistyped confirmation costs no attempt
    throttle = request.app.state.login_throttle
    key = f"user:{user.id}"  # shared with /password: both guess the same password
    if not throttle.try_acquire(key):
        raise HTTPException(429, WRONG_PASSWORD + TRY_LATER)
    if not verify_password(user.password_hash, req.password):
        raise HTTPException(400, WRONG_PASSWORD)  # already counted by try_acquire
    throttle.clear(key)
    keys = delete_account(db, user)
    db.commit()  # the rows go first: a failed commit leaves every file in place
    storage = request.app.state.storage
    for k in keys:
        try:
            storage.delete(k)  # a missing file is not an error
        except Exception:  # the account is already gone; keep removing the rest and still sign out
            log.warning("Could not remove a preview file after deleting an account.", exc_info=True)
    clear_session_cookie(response)
