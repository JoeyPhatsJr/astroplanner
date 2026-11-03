"""Curated variable-star catalog (facts from AAVSO VSX; see app/data/ATTRIBUTION.md)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.astrolog.headers import normalize_object

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "variables.json"


@lru_cache(maxsize=1)
def _load() -> dict[str, Any]:
    return json.loads(DATA_FILE.read_text(encoding="utf-8"))


def catalog_meta() -> dict[str, Any]:
    return _load()["meta"]


def all_stars() -> list[dict[str, Any]]:
    return _load()["stars"]


@lru_cache(maxsize=1)
def _by_id() -> dict[str, dict[str, Any]]:
    return {s["id"]: s for s in all_stars()}


def get_star(star_id: str) -> dict[str, Any] | None:
    return _by_id().get(star_id)


def star_by_slug(slug: str) -> dict[str, Any] | None:
    return get_star(f"var:{slug}")


@lru_cache(maxsize=1)
def alias_index() -> dict[str, str]:
    """Normalized alias (as for AstroLog object names) -> star id."""
    out: dict[str, str] = {}
    for s in all_stars():
        for alias in {s["name"], s["primary_designation"], *s["aliases"]}:
            out[normalize_object(alias)] = s["id"]
    return out


def target_view(star: dict[str, Any]) -> dict[str, Any]:
    """Minimal target-shaped view, so plans and AstroLog can treat stars like targets."""
    return {
        "id": star["id"],
        "primary_designation": star["primary_designation"],
        "name": star["name"],
        "category": "variable",
        "kind": "variable",
        "constellation": star["constellation"],
        "ra_deg": star["ra_deg"],
        "dec_deg": star["dec_deg"],
    }
