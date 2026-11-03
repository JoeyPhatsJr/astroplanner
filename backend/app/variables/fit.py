"""Seestar S30 brightness-fit estimate. The range is an estimate, not a measured limit."""

from __future__ import annotations

from typing import Any

S30_ESTIMATED_RANGE = (7.0, 12.5)
S30_FIT_LABEL = "estimate, not yet measured"


def seestar_fit(star: dict[str, Any]) -> dict[str, Any]:
    lo, hi = S30_ESTIMATED_RANGE
    vsx = star["vsx"]
    parts = [f"Estimated S30 working range is about V {lo:g} to {hi:g} (estimate, not yet measured)."]
    mx, mn = vsx.get("max_mag"), vsx.get("min_mag")
    if mx is not None and mx < lo:
        parts.append(f"The VSX maximum is {mx:g}; near maximum it is probably too bright for the S30.")
    if mn is not None and mn > hi:
        parts.append(f"The VSX minimum is {mn:g}; near minimum it is probably too faint.")
    if len(parts) == 1 and mx is not None and mn is not None:
        parts.append(f"The VSX range {mx:g} to {mn:g} sits inside it.")
    return {"estimate_range": [lo, hi], "label": S30_FIT_LABEL, "text": " ".join(parts)}
