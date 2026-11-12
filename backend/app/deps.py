"""Shared FastAPI dependencies and helpers: the per-request DB session and body validation."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any, TypeVar

from fastapi import HTTPException, Request
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

M = TypeVar("M", bound=BaseModel)


def get_db(request: Request) -> Iterator[Session]:
    with request.app.state.db.session() as s:
        yield s


def validate_body(model: type[M], body: Any) -> M:
    """Validate ``body`` against ``model``; a failure is a 422 listing only ``loc``, ``msg`` and ``type``.

    FastAPI's default 422 echoes the offending ``input``, which could be a password or header bytes.
    """
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        raise HTTPException(422, [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]}
                                  for e in exc.errors(include_input=False, include_url=False)])
