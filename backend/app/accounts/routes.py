"""Auth routes: /api/auth/{signup,login,logout,me,password}.

Bodies are validated with ``validate_body`` so a 422 never echoes a password back. Sign-in failures read
the same for an unknown email and a wrong password, and an unknown email still runs a hash verification.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.deps import get_db, validate_body

from .core import (DUMMY_HASH, AccountInputError, check_password, create_session, hash_password, iso_utc,
                   normalize_email, revoke_other_sessions, revoke_session, verify_password)
from .deps import COOKIE_NAME, clear_session_cookie, current_user, set_session_cookie
from .models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])

SIGN_IN_FAILED = "That email and password don’t match. Check them, or reset your password."
TRY_LATER = " Try again in a few minutes."
SIGNUP_THROTTLED = "Too many attempts from here. Try again in a few minutes."
EMAIL_TAKEN = "An account with this email already exists. Sign in instead."
WRONG_PASSWORD = "That password isn’t right."

# Generous bounds on the raw strings so a huge body is refused before hashing; the account rules
# (and their exact messages) are applied in code, not here.
_RAW = 4096


class Credentials(BaseModel):
    email: str = Field(..., max_length=_RAW)
    password: str = Field(..., max_length=_RAW)


class PasswordChange(BaseModel):
    current_password: str = Field(..., max_length=_RAW)
    new_password: str = Field(..., max_length=_RAW)


def me_out(user: User) -> dict[str, Any]:
    return {"email": user.email, "created_at": user.created_at, "claimed_existing": bool(user.claimed_existing)}


def _client_key(request: Request) -> str:
    return f"signup:{request.client.host if request.client else 'unknown'}"


@router.post("/signup", status_code=201)
def signup(request: Request, response: Response, body: Any = Body(...),
           db: Session = Depends(get_db)) -> dict[str, Any]:
    req = validate_body(Credentials, body)
    throttle = request.app.state.signup_throttle
    key = _client_key(request)
    if throttle.locked(key):
        raise HTTPException(429, SIGNUP_THROTTLED)
    try:
        email = normalize_email(req.email)
        check_password(req.password)
    except AccountInputError as exc:
        raise HTTPException(422, exc.message)
    if db.scalar(select(User.id).where(User.email == email)) is not None:
        throttle.fail(key)  # only an existing email counts: that is how addresses would be probed
        raise HTTPException(409, EMAIL_TAKEN)
    now = request.app.state.clock()
    user = User(email=email, password_hash=hash_password(req.password), created_at=iso_utc(now))
    db.add(user)
    try:
        db.flush()
    except IntegrityError:  # the same email signed up a moment ago
        db.rollback()
        throttle.fail(key)
        raise HTTPException(409, EMAIL_TAKEN)
    token = create_session(db, user, now)
    db.commit()
    set_session_cookie(response, request, token)
    return me_out(user)


@router.post("/login")
def login(request: Request, response: Response, body: Any = Body(...),
          db: Session = Depends(get_db)) -> dict[str, Any]:
    req = validate_body(Credentials, body)
    email = req.email.strip().lower()  # no format check: a malformed email simply matches no account
    throttle = request.app.state.login_throttle
    key = f"email:{email}"
    if throttle.locked(key):
        raise HTTPException(429, SIGN_IN_FAILED + TRY_LATER)
    user = db.scalar(select(User).where(User.email == email))
    ok = verify_password(user.password_hash if user else DUMMY_HASH, req.password)
    if user is None or not ok:
        throttle.fail(key)
        raise HTTPException(401, SIGN_IN_FAILED)
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
    if not verify_password(user.password_hash, req.current_password):
        raise HTTPException(400, WRONG_PASSWORD)
    try:
        check_password(req.new_password)
    except AccountInputError as exc:
        raise HTTPException(422, exc.message)
    user.password_hash = hash_password(req.new_password)
    revoke_other_sessions(db, user.id, keep_token=request.cookies.get(COOKIE_NAME))
    db.commit()
