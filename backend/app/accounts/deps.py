"""The ``current_user`` / ``optional_user`` dependencies and the session cookie.

Swapping to Supabase Auth later means replacing these dependencies.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.deps import get_db

from .core import SESSION_LIFETIME, resolve_session
from .models import User

COOKIE_NAME = "astroplanner_session"
SIGN_IN_REQUIRED = "Sign in to continue."


def set_session_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(COOKIE_NAME, token, max_age=int(SESSION_LIFETIME.total_seconds()), path="/",
                        httponly=True, samesite="lax", secure=request.url.scheme == "https")


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, samesite="lax")


def optional_user(request: Request, response: Response, db: Session = Depends(get_db)) -> User | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    resolved = resolve_session(db, token, request.app.state.clock())
    db.commit()  # keep a renewal, or the deletion of an expired row, even when the route then fails
    if resolved is None:
        return None
    user, renewed = resolved
    if renewed:
        set_session_cookie(response, request, token)
    return user


def current_user(request: Request, response: Response, db: Session = Depends(get_db)) -> User:
    user = optional_user(request, response, db)
    if user is None:
        raise HTTPException(401, SIGN_IN_REQUIRED)
    return user
