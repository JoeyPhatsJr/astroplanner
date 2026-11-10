"""Curated deep-sky target catalog (derived from OpenNGC, CC-BY-SA-4.0)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

from .sky_images import sky_field_arcmin

DATA_FILE = Path(__file__).resolve().parent / "data" / "targets.json"


@lru_cache(maxsize=1)
def _load() -> dict[str, Any]:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    for t in data["targets"]:
        t["sky_field_arcmin"] = sky_field_arcmin(t["id"], t.get("angular_major_arcmin"))
    return data


def catalog_meta() -> dict[str, Any]:
    d = _load()
    return {k: v for k, v in d.items() if k != "targets"} | {"count": len(d["targets"])}


def all_targets() -> list[dict[str, Any]]:
    return _load()["targets"]


@lru_cache(maxsize=1)
def _index() -> dict[str, int]:
    return {t["id"]: i for i, t in enumerate(all_targets())}


def get_target(target_id: str) -> dict[str, Any] | None:
    i = _index().get(target_id)
    return None if i is None else all_targets()[i]


def target_index(target_id: str) -> int | None:
    return _index().get(target_id)


@lru_cache(maxsize=1)
def coordinate_arrays() -> tuple[np.ndarray, np.ndarray]:
    ts = all_targets()
    return (
        np.array([t["ra_deg"] for t in ts], dtype=float),
        np.array([t["dec_deg"] for t in ts], dtype=float),
    )


def search(query: str | None = None, category: str | None = None) -> list[dict[str, Any]]:
    q = (query or "").strip().lower().replace(" ", "")
    out = []
    for t in all_targets():
        if category and category != "all" and t["category"] != category:
            continue
        if q:
            hay = [t["id"], t["primary_designation"], t["name"], t["constellation"], t["kind"], *t["aliases"]]
            if not any(q in h.lower().replace(" ", "") for h in hay):
                continue
        out.append(t)
    return out
