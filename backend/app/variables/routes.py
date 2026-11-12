"""Variable-star HTTP routes (thin). Visibility reuses the DSO helpers; no score is computed.

The catalog is open. Nights and mission progress are personal: they come only from the signed-in user's own
AstroLog, and signed out there are none (``None``, never another user's count, and never a 401).
"""

from __future__ import annotations

from datetime import date
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.accounts.deps import optional_user
from app.accounts.models import User
from app.api import DEFAULT_MIN_ALT_DEG, Darkness, Observer, _now, observer_params
from app.astronomy import iso_utc, night_summary, sky_context
from app.db import EquipmentProfile
from app.variables import catalog, missions
from app.variables.fit import seestar_fit
from app.visibility import analyse_target, visibility_payload

router = APIRouter(prefix="/api/variables", tags=["variables"])

VSX_ATTRIBUTION = "Catalog data: International Variable Star Index (VSX), operated at AAVSO, Cambridge, Massachusetts, USA."

MISSION_TEXT = {
    "weekly": ("Weekly watch", "At least one night every week.", None, "week streak"),
    "cycle": ("Follow the cycle", "One night a month for 6 months.", 6, "months"),
}


def _today(tz: str | None) -> date:
    """Mission "today": the observer's local date when an IANA timezone is given, else the UTC date."""
    if tz is None:
        return _now().date()
    try:
        zone = ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, f"Unknown IANA timezone: {tz!r}")
    return _now().astimezone(zone).date()


def _star_or_404(slug: str) -> dict[str, Any]:
    star = catalog.star_by_slug(slug)
    if star is None:
        raise HTTPException(404, f"Unknown variable star {slug!r}")
    return star


def _is_s30_preset(request: Request, equipment_id: str | None) -> bool:
    if not equipment_id:
        return False
    with request.app.state.db.session() as s:
        eq = s.get(EquipmentProfile, equipment_id)
        return bool(eq and eq.is_preset and eq.id == "seestar-s30")


def _mission_list(star: dict[str, Any], nights: list[date] | None, today: date) -> list[dict[str, Any]]:
    """The star's missions; ``progress`` is None when there is no signed-in user (``nights is None``)."""
    out = []
    for key in star["missions"]:
        title, desc, goal, unit = MISSION_TEXT[key]
        progress: int | None = None
        if nights is not None and key == "weekly":
            progress = missions.weekly_streak(nights, today)
        elif nights is not None:
            progress = missions.monthly_count(nights, today, 6)
        out.append({"key": key, "title": title, "description": desc, "progress": progress, "goal": goal, "unit": unit})
    return out


@router.get("")
def list_stars(request: Request, timezone: str | None = Query(None, description="Observer IANA timezone"),
               user: User | None = Depends(optional_user)) -> dict[str, Any]:
    _today(timezone)  # validated for symmetry with the detail route; the list shows no mission progress
    db = request.app.state.db
    stars = []
    for s in catalog.all_stars():
        v = s["vsx"]
        stars.append({**catalog.target_view(s), "type_label": s["type_label"], "slug": s["slug"],
                      "vsx": {"max_mag": v["max_mag"], "min_mag": v["min_mag"], "band": v["band"],
                              "raw_range": v["raw_range"]},
                      "nights_count": len(missions.star_nights(db, s["id"], user.id)) if user else None})
    return {"stars": stars}


@router.get("/{slug}")
def star_detail(slug: str, request: Request, equipment_id: str | None = Query(None),
                timezone: str | None = Query(None, description="Observer IANA timezone (mission 'today')"),
                user: User | None = Depends(optional_user)) -> dict[str, Any]:
    star = _star_or_404(slug)
    today = _today(timezone)
    db = request.app.state.db
    nights = missions.star_nights(db, star["id"], user.id) if user else None  # signed out: never queried
    return {
        "star": catalog.target_view(star),
        "vsx": star["vsx"],
        "type_label": star["type_label"],
        "period_note": star.get("period_note"),
        "source_url": star["source_url"],
        "retrieved": star["retrieved"],
        "attribution": [VSX_ATTRIBUTION],
        "nights": [n.isoformat() for n in nights or ()],
        "missions": _mission_list(star, nights, today),
        "seestar_fit": seestar_fit(star) if _is_s30_preset(request, equipment_id) else None,
    }


@router.get("/{slug}/visibility")
def star_visibility(
    slug: str,
    o: Observer = Depends(observer_params),
    min_altitude_deg: float = Query(DEFAULT_MIN_ALT_DEG, ge=0, le=80),
    darkness: Darkness = "astronomical",
) -> dict[str, Any]:
    star = _star_or_404(slug)
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
