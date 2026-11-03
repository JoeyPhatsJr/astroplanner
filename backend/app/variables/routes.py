"""Variable-star HTTP routes (thin). Visibility reuses the DSO helpers; no score is computed."""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query

from app.api import DEFAULT_MIN_ALT_DEG, Darkness, Observer, _now, observer_params
from app.astronomy import iso_utc, night_summary, sky_context
from app.variables import catalog
from app.visibility import analyse_target, visibility_payload

router = APIRouter(prefix="/api/variables", tags=["variables"])


@router.get("/{slug}/visibility")
def star_visibility(
    slug: str,
    o: Observer = Depends(observer_params),
    min_altitude_deg: float = Query(DEFAULT_MIN_ALT_DEG, ge=0, le=80),
    darkness: Darkness = "astronomical",
) -> dict[str, Any]:
    star = catalog.star_by_slug(slug)
    if star is None:
        raise HTTPException(404, f"Unknown variable star {slug!r}")
    ctx = sky_context(o.lat, o.lon, float(o.elevation_m), o.night, o.tz,
                      coords=((star["ra_deg"],), (star["dec_deg"],)))
    vis = analyse_target(ctx, 0, star["dec_deg"], min_altitude_deg, darkness)
    payload = visibility_payload(vis, ctx, min_altitude_deg, include_series=True)
    payload["series"]["sun_alt_deg"] = np.round(ctx.sun_alt, 2).tolist()
    payload["series"]["moon_alt_deg"] = np.round(ctx.moon_alt, 2).tolist()
    night = night_summary(ctx, darkness)
    return {
        "computed_at_utc": iso_utc(_now().timestamp()),
        "star": catalog.target_view(star),
        "visibility": payload,
        "night": {k: night[k] for k in ("events", "dark_intervals", "display_start_utc", "display_end_utc",
                                        "has_darkness", "notes", "moon", "timezone", "night_date")},
    }
