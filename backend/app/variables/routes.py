"""Variable-star HTTP routes (thin). Visibility reuses the DSO helpers; no score is computed."""

from __future__ import annotations

from datetime import date
from typing import Any

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api import DEFAULT_MIN_ALT_DEG, Darkness, Observer, _now, observer_params
from app.astronomy import iso_utc, night_summary, sky_context
from app.db import EquipmentProfile
from app.variables import catalog, missions
from app.variables.fit import seestar_fit
from app.visibility import analyse_target, visibility_payload

router = APIRouter(prefix="/api/variables", tags=["variables"])

VSX_ATTRIBUTION = "Catalog data: International Variable Star Index (VSX), operated at AAVSO, Cambridge, Massachusetts, USA."
OBS_ATTRIBUTION = "Observations from the AAVSO International Database, contributed by observers worldwide. © AAVSO."

MISSION_TEXT = {
    "outburst": ("Catch an outburst", "Shoot it on 3 nights during one outburst.", 3, "nights"),
    "weekly": ("Weekly watch", "At least one night every week.", None, "week streak"),
    "cycle": ("Follow the cycle", "One night a month for 6 months.", 6, "months"),
}


def _aavso_info(request: Request) -> dict[str, Any]:
    enabled = request.app.state.aavso is not None
    return {"enabled": enabled, "mode": request.app.state.aavso_mode if enabled else "off"}


def _is_s30_preset(request: Request, equipment_id: str | None) -> bool:
    if not equipment_id:
        return False
    with request.app.state.db.session() as s:
        eq = s.get(EquipmentProfile, equipment_id)
        return bool(eq and eq.is_preset and eq.id == "seestar-s30")


def _mission_list(star: dict[str, Any], nights: list[date], today: date, aavso_on: bool) -> list[dict[str, Any]]:
    out = []
    for key in star["missions"]:
        title, desc, goal, unit = MISSION_TEXT[key]
        m: dict[str, Any] = {"key": key, "title": title, "description": desc, "progress": 0,
                             "goal": goal, "unit": unit, "available": True}
        if key == "weekly":
            m["progress"] = missions.weekly_streak(nights, today)
        elif key == "cycle":
            m["progress"] = missions.monthly_count(nights, today, 6)
        else:  # outburst windows need AAVSO data (Task 7)
            m["available"] = False
            m["reason"] = "Outburst windows not computed yet" if aavso_on else "Needs AAVSO data (off)"
        out.append(m)
    return out


@router.get("")
def list_stars(request: Request) -> dict[str, Any]:
    db = request.app.state.db
    stars = []
    for s in catalog.all_stars():
        v = s["vsx"]
        stars.append({**catalog.target_view(s), "type_label": s["type_label"], "slug": s["slug"],
                      "vsx": {"max_mag": v["max_mag"], "min_mag": v["min_mag"], "band": v["band"],
                              "raw_range": v["raw_range"]},
                      "nights_count": len(missions.star_nights(db, s["id"])), "alert": None})
    return {"aavso": _aavso_info(request), "stars": stars}


@router.get("/{slug}")
def star_detail(slug: str, request: Request, equipment_id: str | None = Query(None)) -> dict[str, Any]:
    star = catalog.star_by_slug(slug)
    if star is None:
        raise HTTPException(404, f"Unknown variable star {slug!r}")
    nights = missions.star_nights(request.app.state.db, star["id"])
    info = _aavso_info(request)
    attribution = [VSX_ATTRIBUTION] + ([OBS_ATTRIBUTION] if info["enabled"] else [])
    return {
        "star": catalog.target_view(star),
        "vsx": star["vsx"],
        "type_label": star["type_label"],
        "period_note": star.get("period_note"),
        "source_url": star["source_url"],
        "retrieved": star["retrieved"],
        "attribution": attribution,
        "nights": [n.isoformat() for n in nights],
        "missions": _mission_list(star, nights, _now().date(), info["enabled"]),
        "seestar_fit": seestar_fit(star) if _is_s30_preset(request, equipment_id) else None,
        "aavso": {**info, "fallback_link": star["source_url"]},
    }


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
