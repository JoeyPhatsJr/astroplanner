"""Unified target lookup: deep-sky catalog ids and ``var:<slug>`` variable stars."""

from __future__ import annotations

from typing import Any

from app import catalog
from app.variables import catalog as variables


def is_variable(target_id: str) -> bool:
    return variables.get_star(target_id) is not None


def lookup(target_id: str) -> dict[str, Any] | None:
    dso = catalog.get_target(target_id)
    if dso is not None:
        return dso
    star = variables.get_star(target_id)
    return None if star is None else variables.target_view(star)
