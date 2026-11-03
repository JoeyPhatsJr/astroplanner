"""Variable-star HTTP routes (thin). Visibility reuses the DSO helpers; no score is computed."""

from __future__ import annotations

from datetime import date
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import numpy as np
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response

from app.api import DEFAULT_MIN_ALT_DEG, Darkness, Observer, _now, observer_params
from app.astronomy import iso_utc, night_summary, sky_context
from app.db import EquipmentProfile
from app.variables import alerts, cache, catalog, curve, missions
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


AAVSO_OFF = "AAVSO observations are switched off on this server (ASTROPLANNER_AAVSO_ENABLED is not set)."


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


def _aavso_info(request: Request) -> dict[str, Any]:
    enabled = request.app.state.aavso is not None
    return {"enabled": enabled, "mode": request.app.state.aavso_mode if enabled else "off"}


def _is_s30_preset(request: Request, equipment_id: str | None) -> bool:
    if not equipment_id:
        return False
    with request.app.state.db.session() as s:
        eq = s.get(EquipmentProfile, equipment_id)
        return bool(eq and eq.is_preset and eq.id == "seestar-s30")


def _mission_list(star: dict[str, Any], nights: list[date], today: date, aavso_on: bool,
                  outburst_windows: list[tuple[date, date]]) -> list[dict[str, Any]]:
    out = []
    for key in star["missions"]:
        title, desc, goal, unit = MISSION_TEXT[key]
        m: dict[str, Any] = {"key": key, "title": title, "description": desc, "progress": 0,
                             "goal": goal, "unit": unit, "available": True}
        if key == "weekly":
            m["progress"] = missions.weekly_streak(nights, today)
        elif key == "cycle":
            m["progress"] = missions.monthly_count(nights, today, 6)
        elif aavso_on:
            m["progress"] = missions.outburst_nights(nights, outburst_windows)
            m["note"] = (f"Outburst days: cached AAVSO daily means brighter than {star['alert']['brighter_than']} V "
                         "(UT dates).")
        else:
            m["available"] = False
            m["reason"] = "Needs AAVSO data (off)"
        out.append(m)
    return out


@router.get("")
def list_stars(request: Request, timezone: str | None = Query(None, description="Observer IANA timezone")
               ) -> dict[str, Any]:
    _today(timezone)  # validated for symmetry with the detail route; the list shows no mission progress
    db = request.app.state.db
    stars = []
    for s in catalog.all_stars():
        v = s["vsx"]
        stars.append({**catalog.target_view(s), "type_label": s["type_label"], "slug": s["slug"],
                      "vsx": {"max_mag": v["max_mag"], "min_mag": v["min_mag"], "band": v["band"],
                              "raw_range": v["raw_range"]},
                      "nights_count": len(missions.star_nights(db, s["id"]))})
    return {"aavso": _aavso_info(request), "stars": stars}


@router.get("/alerts")
def sky_alerts(
    request: Request,
    o: Observer = Depends(observer_params),
    min_altitude_deg: float = Query(DEFAULT_MIN_ALT_DEG, ge=0, le=80),
    darkness: Darkness = "astronomical",
) -> dict[str, Any]:
    """Refresh the 3-day alert window of each star with an alert rule (sequentially), then evaluate."""
    provider = request.app.state.aavso
    if provider is None:
        return {"enabled": False, "mode": "off", "alerts": [], "dot": False}
    now = _now()
    out = []
    with request.app.state.db.session() as s:
        for star in (st for st in catalog.all_stars() if st["alert"]):
            cache.refresh_alert_window(s, provider, star, now)
            result, ep = alerts.current(s, star, now)
            if result["state"] == "alert" and alerts.is_dismissed(s, star["id"], ep):
                continue
            visibility = None
            if result["state"] == "alert":
                ctx = sky_context(o.lat, o.lon, float(o.elevation_m), o.night, o.tz,
                                  coords=((star["ra_deg"],), (star["dec_deg"],)))
                vis = analyse_target(ctx, 0, star["dec_deg"], min_altitude_deg, darkness)
                visibility = visibility_payload(vis, ctx, min_altitude_deg, include_series=False)
            out.append({**result, "slug": star["slug"], "name": star["name"], "visibility": visibility})
    return {"enabled": True, "mode": request.app.state.aavso_mode, "alerts": out, "dot": any(a["state"] == "alert" for a in out),
            "attribution": [VSX_ATTRIBUTION, OBS_ATTRIBUTION]}


@router.get("/{slug}")
def star_detail(slug: str, request: Request, equipment_id: str | None = Query(None),
                timezone: str | None = Query(None, description="Observer IANA timezone (mission 'today')")
                ) -> dict[str, Any]:
    star = _star_or_404(slug)
    today = _today(timezone)
    db = request.app.state.db
    nights = missions.star_nights(db, star["id"])
    info = _aavso_info(request)
    windows = (missions.cached_outburst_windows(db, star, nights)
               if info["enabled"] and "outburst" in star["missions"] else [])
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
        "missions": _mission_list(star, nights, today, info["enabled"], windows),
        "seestar_fit": seestar_fit(star) if _is_s30_preset(request, equipment_id) else None,
        "aavso": {**info, "fallback_link": star["source_url"]},
    }


@router.get("/{slug}/curve")
def star_curve(slug: str, request: Request, background: BackgroundTasks,
               window: str = Query(curve.RECENT, description="'recent' (last 365 days) or a history window key")
               ) -> dict[str, Any]:
    """What is cached now; the history fill (or refresh) runs after the response, so polling sees progress."""
    star = _star_or_404(slug)
    provider = request.app.state.aavso
    if provider is None:
        raise HTTPException(409, AAVSO_OFF)
    w = curve.resolve_window(star, window)
    if w is None:
        raise HTTPException(422, f"Unknown light-curve window {window!r} for {star['name']}")
    now = _now()
    with request.app.state.db.session() as s:
        body = curve.payload(s, star, w, now, [VSX_ATTRIBUTION, OBS_ATTRIBUTION])
    body["mode"] = request.app.state.aavso_mode  # "fixture" = synthetic test data, never AAVSO observations
    # Always one task: the fill itself is a no-op when fresh, in progress or backing off, so a
    # "loading" status is always followed by a fill and polling ends.
    background.add_task(curve.run_fill, request.app.state.db, provider, star, w, now)
    return body


@router.post("/{slug}/alerts/dismiss", status_code=204)
def dismiss_alert(slug: str, request: Request) -> Response:
    """Hide the star's current alert episode (from cached data; no provider call)."""
    star = _star_or_404(slug)
    if not star["alert"]:
        raise HTTPException(404, f"{star['name']} has no sky alert rule")
    if request.app.state.aavso is None:
        raise HTTPException(409, AAVSO_OFF)
    now = _now()
    with request.app.state.db.session() as s:
        result, ep = alerts.current(s, star, now)
        if result["state"] != "alert" or ep is None:
            raise HTTPException(409, f"{star['name']} has no current alert to dismiss")
        alerts.dismiss(s, star["id"], ep, now)
    return Response(status_code=204)


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
