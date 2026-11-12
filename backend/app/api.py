"""HTTP API. Astronomy is computed server-side; the frontend only formats it."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import astropy
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, object_session

from . import catalog, geo, targets
from .astrolog.library import capture_info, session_capture_info
from .astrolog.models import CaptureSet
from .astronomy import DARKNESS_THRESHOLDS, darkness_intervals, iso_utc, night_bounds_utc, night_summary, sky_context
from .deps import get_db  # noqa: F401  (re-exported: other routers import it from here)
from .db import EquipmentProfile, ObservingLocation, ObservingSession, SessionTarget
from .sky_images import BUSY_RETRY_AFTER_S, SkyImageBusy, SkyImageProvider
from .scoring import TARGET_WEIGHTS, TONIGHT_WEIGHTS, night_clear, target_score, tonight_score
from .visibility import DEFAULT_MIN_ALT_DEG, analyse_target, visibility_payload
from .weather import OpenMeteoProvider, align_to_grid, forecast_payload

router = APIRouter(prefix="/api")

Darkness = Literal["astronomical", "nautical"]
MIN_DATE, MAX_DATE = date(1950, 1, 1), date(2099, 12, 31)


# ---- dependencies ------------------------------------------------------------

def get_weather(request: Request) -> OpenMeteoProvider:
    return request.app.state.weather


class Observer(BaseModel):
    lat: float
    lon: float
    elevation_m: float
    night: date
    tz: str


def observer_params(
    lat: float = Query(..., ge=-90, le=90, description="Latitude, decimal degrees (north positive)"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude, decimal degrees (east positive)"),
    date_: date = Query(..., alias="date", description="Local night date: evening of this date to next morning"),
    timezone_: str = Query(..., alias="timezone", description="IANA timezone, e.g. America/New_York"),
    elevation_m: float = Query(0.0, ge=-500, le=9000),
) -> Observer:
    try:
        ZoneInfo(timezone_)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, f"Unknown IANA timezone: {timezone_!r}")
    if not (MIN_DATE <= date_ <= MAX_DATE):
        raise HTTPException(422, "Date must be between 1950-01-01 and 2099-12-31.")
    return Observer(lat=round(lat, 5), lon=round(lon, 5), elevation_m=round(elevation_m), night=date_, tz=timezone_)


def _ctx(o: Observer):
    return sky_context(o.lat, o.lon, float(o.elevation_m), o.night, o.tz)


def _weather_for(o: Observer, ctx, provider: OpenMeteoProvider):
    start, end = night_bounds_utc(o.night, o.tz)
    fc = provider.forecast(o.lat, o.lon, start, end)
    return fc, align_to_grid(fc, ctx.t)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _lead_ref(ctx, darkness: str = "astronomical") -> float:
    """Start of darkness (or of the evening's first sub-horizon Sun) for forecast lead time."""
    dark = darkness_intervals(ctx, darkness)
    if dark:
        return dark[0][0]
    below = np.nonzero(ctx.sun_alt < 0)[0]
    return float(ctx.t[below[0]]) if below.size else float(ctx.t[0])


# ---- health / meta -------------------------------------------------------------

@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict[str, Any]:
    db_ok = True
    try:
        db.execute(select(1))
    except Exception:  # pragma: no cover - reported, not raised
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "database": "ok" if db_ok else "error",
        "astropy_version": astropy.__version__,
        "catalog_targets": catalog.catalog_meta()["count"],
        "time_utc": iso_utc(_now().timestamp()),
    }


DSS_ACKNOWLEDGMENT = (
    "Investigators using these scans are requested to include these acknowledgments in any publications as appropriate.\n\n"
    "The Digitized Sky Surveys were produced at the Space Telescope Science Institute under U.S. Government grant NAG W-2166. "
    "The images of these surveys are based on photographic data obtained using the Oschin Schmidt Telescope on Palomar Mountain "
    "and the UK Schmidt Telescope. The plates were processed into the present compressed digital form with the permission of these institutions.\n\n"
    "The National Geographic Society - Palomar Observatory Sky Atlas (POSS-I) was made by the California Institute of Technology "
    "with grants from the National Geographic Society.\n\n"
    "The Second Palomar Observatory Sky Survey (POSS-II) was made by the California Institute of Technology with funds from the "
    "National Science Foundation, the National Geographic Society, the Sloan Foundation, the Samuel Oschin Foundation, and the Eastman Kodak Corporation.\n\n"
    "The Oschin Schmidt Telescope is operated by the California Institute of Technology and Palomar Observatory.\n\n"
    "The UK Schmidt Telescope was operated by the Royal Observatory Edinburgh, with funding from the UK Science and Engineering Research Council "
    "(later the UK Particle Physics and Astronomy Research Council), until 1988 June, and thereafter by the Anglo-Australian Observatory. "
    "The blue plates of the southern Sky Atlas and its Equatorial Extension (together known as the SERC-J), as well as the Equatorial Red (ER), "
    "and the Second Epoch [red] Survey (SES) were all taken with the UK Schmidt.\n\n"
    "All data are subject to the copyright given in the copyright summary. Copyright information specific to individual plates is provided in the downloaded FITS headers.\n\n"
    "Supplemental funding for sky-survey work at the ST ScI is provided by the European Southern Observatory."
)


@router.get("/about")
def about() -> dict[str, Any]:
    meta = catalog.catalog_meta()
    return {
        "data_sources": [
            {"name": "OpenNGC", "use": "Deep-sky target coordinates, types, sizes, magnitudes",
             "url": meta["source_repository"], "license": meta["license"], "version": meta["source_commit"]},
            {"name": "Open-Meteo Forecast API", "use": "Hourly weather forecasts",
             "url": "https://open-meteo.com/", "license": "CC BY 4.0 data; free tier non-commercial only"},
            {"name": "Open-Meteo Geocoding API", "use": "Place search",
             "url": "https://open-meteo.com/en/docs/geocoding-api", "license": "CC BY 4.0"},
            {"name": "Astropy", "use": "Sun, Moon and target positions", "url": "https://www.astropy.org/",
             "license": "BSD-3-Clause", "version": astropy.__version__},
            {"name": "timezonefinder", "use": "Offline timezone for coordinates",
             "url": "https://github.com/jannikmi/timezonefinder", "license": "MIT"},
            {"name": "Digitized Sky Surveys (STScI)", "use": "Sky images on target cards and details (red plates, cached locally)",
             "url": "https://archive.stsci.edu/dss/acknowledging.html",
             "license": "© AURA and the plate copyright holders; non-profit use",
             "acknowledgment": DSS_ACKNOWLEDGMENT},
        ],
        "score_weights": {"tonight": TONIGHT_WEIGHTS, "target": TARGET_WEIGHTS},
        "darkness_thresholds_deg": DARKNESS_THRESHOLDS,
    }


# ---- geocoding -----------------------------------------------------------------

@router.get("/geocode")
def geocode(q: str = Query(..., min_length=2, max_length=100)) -> dict[str, Any]:
    try:
        return {"results": geo.search_places(q), "source": "Open-Meteo Geocoding API"}
    except geo.GeocodeError as exc:
        raise HTTPException(502, str(exc))


@router.get("/timezone")
def timezone_lookup(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)) -> dict[str, Any]:
    return {"timezone": geo.timezone_at(lat, lon), "source": "timezonefinder (offline boundary data)"}


# ---- catalog -------------------------------------------------------------------

def _client_target(t: dict[str, Any], request: Request) -> dict[str, Any]:
    """A catalog target as sent to clients: no sky-image field width when images are off, so none are requested."""
    if request.app.state.sky_images.enabled:
        return t
    return t | {"sky_field_arcmin": None}


@router.get("/targets")
def list_targets(
    request: Request,
    query: str | None = Query(None, max_length=60),
    category: Literal["all", "galaxy", "nebula", "cluster"] = "all",
) -> dict[str, Any]:
    items = [_client_target(t, request) for t in catalog.search(query, category)]
    return {"count": len(items), "targets": items, "catalog": catalog.catalog_meta()}


@router.get("/targets/{target_id}")
def get_target(target_id: str, request: Request) -> dict[str, Any]:
    t = catalog.get_target(target_id)
    if t is None:
        raise HTTPException(404, f"Unknown target {target_id!r}")
    return _client_target(t, request)


@router.get("/targets/{target_id}/sky-image")
def target_sky_image(target_id: str, request: Request) -> FileResponse:
    t = catalog.get_target(target_id)
    if t is None:
        raise HTTPException(404, f"Unknown target {target_id!r}")
    provider: SkyImageProvider = request.app.state.sky_images
    try:
        path = provider.get(t["id"], t["ra_deg"], t["dec_deg"], t["sky_field_arcmin"])
    except SkyImageBusy:
        # Answer at once rather than hold one of the browser's few connections while another fetch runs.
        raise HTTPException(503, "Sky survey image busy; retry shortly", headers={"Retry-After": str(BUSY_RETRY_AFTER_S)})
    if path is None:
        raise HTTPException(503, "Sky survey image unavailable right now")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=604800"})


# ---- astronomy -----------------------------------------------------------------

@router.get("/night")
def night(o: Observer = Depends(observer_params), darkness: Darkness = "astronomical") -> dict[str, Any]:
    return night_summary(_ctx(o), darkness)


@router.get("/forecast")
def forecast(o: Observer = Depends(observer_params), provider: OpenMeteoProvider = Depends(get_weather)) -> dict[str, Any]:
    start, end = night_bounds_utc(o.night, o.tz)
    fc = provider.forecast(o.lat, o.lon, start, end)
    return forecast_payload(fc, start.timestamp(), end.timestamp(), _now(), _lead_ref(_ctx(o)))


@router.get("/tonight")
def tonight(
    o: Observer = Depends(observer_params),
    darkness: Darkness = "astronomical",
    provider: OpenMeteoProvider = Depends(get_weather),
) -> dict[str, Any]:
    ctx = _ctx(o)
    fc, grid = _weather_for(o, ctx, provider)
    start, end = night_bounds_utc(o.night, o.tz)
    return {
        "computed_at_utc": iso_utc(_now().timestamp()),
        "night": night_summary(ctx, darkness),
        "forecast": forecast_payload(fc, start.timestamp(), end.timestamp(), _now(), _lead_ref(ctx, darkness)),
        "score": tonight_score(ctx, grid, darkness),
        "night_clear": night_clear(ctx, grid, darkness),
    }


def _equipment_dict(db: Session, equipment_id: str | None) -> dict[str, Any] | None:
    if not equipment_id:
        return None
    eq = db.get(EquipmentProfile, equipment_id)
    if eq is None:
        raise HTTPException(404, f"Unknown equipment profile {equipment_id!r}")
    return _equipment_out(eq)


STATUS_ORDER = ["observable", "too_brief", "daylight_only", "below_threshold", "never_rises", "no_darkness"]


@router.get("/recommendations")
def recommendations(
    request: Request,
    o: Observer = Depends(observer_params),
    equipment_id: str | None = None,
    min_altitude_deg: float = Query(DEFAULT_MIN_ALT_DEG, ge=0, le=80),
    darkness: Darkness = "astronomical",
    category: Literal["all", "galaxy", "nebula", "cluster"] = "all",
    query: str | None = Query(None, max_length=60),
    provider: OpenMeteoProvider = Depends(get_weather),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    ctx = _ctx(o)
    fc, grid = _weather_for(o, ctx, provider)
    eq = _equipment_dict(db, equipment_id)
    night = night_summary(ctx, darkness)
    disp_s = datetime.fromisoformat(night["display_start_utc"].replace("Z", "+00:00")).timestamp()
    disp_e = datetime.fromisoformat(night["display_end_utc"].replace("Z", "+00:00")).timestamp()
    spark_sel = np.nonzero((ctx.t >= disp_s) & (ctx.t <= disp_e))[0][::2]
    spark_t = (ctx.t[spark_sel] * 1000).astype(np.int64).tolist()

    items = []
    for t in catalog.search(query, category):
        idx = catalog.target_index(t["id"])
        vis = analyse_target(ctx, idx, t["dec_deg"], min_altitude_deg, darkness)
        items.append({
            "target": _client_target(t, request),
            "visibility": visibility_payload(vis, ctx, min_altitude_deg, include_series=False),
            "score": target_score(ctx, vis, t, grid, eq, min_altitude_deg),
            "sparkline_alt_deg": np.round(ctx.target_alt[idx][spark_sel], 1).tolist(),
        })
    items.sort(key=lambda r: (
        STATUS_ORDER.index(r["visibility"]["status"]),
        -(r["score"]["normalized"] or 0),
        -(r["visibility"]["culmination_alt_deg"]),
    ))
    return {
        "computed_at_utc": iso_utc(_now().timestamp()),
        "params": {"min_altitude_deg": min_altitude_deg, "darkness": darkness, "equipment_id": equipment_id,
                   "category": category, "query": query},
        "weather_status": fc.status,
        "weather_message": fc.message,
        "has_darkness": night["has_darkness"],
        "observable_count": sum(r["visibility"]["can_observe"] for r in items),
        "sparkline_t_ms": spark_t,
        "results": items,
    }


@router.get("/targets/{target_id}/visibility")
def target_visibility(
    target_id: str,
    request: Request,
    o: Observer = Depends(observer_params),
    min_altitude_deg: float = Query(DEFAULT_MIN_ALT_DEG, ge=0, le=80),
    darkness: Darkness = "astronomical",
    equipment_id: str | None = None,
    provider: OpenMeteoProvider = Depends(get_weather),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    t = catalog.get_target(target_id)
    if t is None:
        raise HTTPException(404, f"Unknown target {target_id!r}")
    ctx = _ctx(o)
    fc, grid = _weather_for(o, ctx, provider)
    idx = catalog.target_index(target_id)
    vis = analyse_target(ctx, idx, t["dec_deg"], min_altitude_deg, darkness)
    payload = visibility_payload(vis, ctx, min_altitude_deg, include_series=True)
    payload["series"]["sun_alt_deg"] = np.round(ctx.sun_alt, 2).tolist()
    payload["series"]["moon_alt_deg"] = np.round(ctx.moon_alt, 2).tolist()
    night = night_summary(ctx, darkness)
    return {
        "computed_at_utc": iso_utc(_now().timestamp()),
        "target": _client_target(t, request),
        "visibility": payload,
        "score": target_score(ctx, vis, t, grid, _equipment_dict(db, equipment_id), min_altitude_deg),
        "night": {k: night[k] for k in ("events", "dark_intervals", "display_start_utc", "display_end_utc",
                                        "has_darkness", "notes", "moon", "timezone", "night_date")},
        "weather_status": fc.status,
    }


# ---- locations -----------------------------------------------------------------

class LocationIn(BaseModel):
    label: str = Field(..., min_length=1, max_length=120)
    latitude_deg: float = Field(..., ge=-90, le=90)
    longitude_deg: float = Field(..., ge=-180, le=180)
    elevation_m: float | None = Field(None, ge=-500, le=9000)
    timezone: str

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError(f"Unknown IANA timezone: {v!r}")
        return v


class LocationPatch(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=120)
    latitude_deg: float | None = Field(None, ge=-90, le=90)
    longitude_deg: float | None = Field(None, ge=-180, le=180)
    elevation_m: float | None = Field(None, ge=-500, le=9000)
    timezone: str | None = None

    _tz = field_validator("timezone")(lambda cls, v: v if v is None else LocationIn._tz(v))


def _location_out(loc: ObservingLocation) -> dict[str, Any]:
    return {c: getattr(loc, c) for c in ("id", "label", "latitude_deg", "longitude_deg", "elevation_m",
                                         "timezone", "is_sample", "created_at")}


@router.get("/locations")
def list_locations(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return [_location_out(x) for x in db.scalars(select(ObservingLocation).order_by(ObservingLocation.created_at))]


@router.post("/locations", status_code=201)
def create_location(body: LocationIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    loc = ObservingLocation(**body.model_dump(), is_sample=False)
    db.add(loc)
    db.commit()
    return _location_out(loc)


@router.patch("/locations/{location_id}")
def update_location(location_id: str, body: LocationPatch, db: Session = Depends(get_db)) -> dict[str, Any]:
    loc = db.get(ObservingLocation, location_id)
    if loc is None:
        raise HTTPException(404, "Location not found")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(loc, k, v)
    if data:  # an edited sample is now the user's own location
        loc.is_sample = False
    db.commit()
    return _location_out(loc)


@router.delete("/locations/{location_id}", status_code=204)
def delete_location(location_id: str, db: Session = Depends(get_db)) -> Response:
    loc = db.get(ObservingLocation, location_id)
    if loc is None:
        raise HTTPException(404, "Location not found")
    in_use = db.scalar(select(func.count()).select_from(ObservingSession).where(ObservingSession.location_id == location_id))
    if in_use:
        raise HTTPException(409, f"Location is used by {in_use} saved session(s).")
    db.delete(loc)
    db.commit()
    return Response(status_code=204)


# ---- equipment -----------------------------------------------------------------

FovDefinition = Literal["unknown", "diagonal", "horizontal", "vertical"]


class EquipmentIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    manufacturer: str | None = Field(None, max_length=120)
    aperture_mm: float | None = Field(None, gt=0, le=2000)
    focal_length_mm: float | None = Field(None, gt=0, le=20000)
    fov_deg: float | None = Field(None, gt=0, le=180)
    fov_definition: FovDefinition = "unknown"
    sensor: str | None = Field(None, max_length=120)
    mount_type: str | None = Field(None, max_length=120)
    notes: str | None = Field(None, max_length=2000)


class EquipmentPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    manufacturer: str | None = Field(None, max_length=120)
    aperture_mm: float | None = Field(None, gt=0, le=2000)
    focal_length_mm: float | None = Field(None, gt=0, le=20000)
    fov_deg: float | None = Field(None, gt=0, le=180)
    fov_definition: FovDefinition | None = None
    sensor: str | None = Field(None, max_length=120)
    mount_type: str | None = Field(None, max_length=120)
    notes: str | None = Field(None, max_length=2000)


def _equipment_out(eq: EquipmentProfile) -> dict[str, Any]:
    out = {c: getattr(eq, c) for c in ("id", "name", "manufacturer", "aperture_mm", "focal_length_mm", "fov_deg",
                                       "fov_definition", "wide_fov_deg", "sensor", "mount_type", "source_url",
                                       "notes", "is_verified", "is_preset", "created_at")}
    out["focal_ratio"] = (round(eq.focal_length_mm / eq.aperture_mm, 2)
                          if eq.focal_length_mm and eq.aperture_mm else None)
    return out


@router.get("/equipment")
def list_equipment(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.scalars(select(EquipmentProfile).order_by(EquipmentProfile.is_preset.desc(), EquipmentProfile.created_at))
    return [_equipment_out(x) for x in rows]


@router.post("/equipment", status_code=201)
def create_equipment(body: EquipmentIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    eq = EquipmentProfile(**body.model_dump(), is_verified=False, is_preset=False)
    db.add(eq)
    db.commit()
    return _equipment_out(eq)


def _custom_or_403(db: Session, equipment_id: str) -> EquipmentProfile:
    eq = db.get(EquipmentProfile, equipment_id)
    if eq is None:
        raise HTTPException(404, "Equipment profile not found")
    if eq.is_preset:
        raise HTTPException(403, "Built-in presets are read-only. Duplicate it to make a custom profile.")
    return eq


@router.patch("/equipment/{equipment_id}")
def update_equipment(equipment_id: str, body: EquipmentPatch, db: Session = Depends(get_db)) -> dict[str, Any]:
    eq = _custom_or_403(db, equipment_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(eq, k, v)
    db.commit()
    return _equipment_out(eq)


@router.post("/equipment/{equipment_id}/duplicate", status_code=201)
def duplicate_equipment(equipment_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    src = db.get(EquipmentProfile, equipment_id)
    if src is None:
        raise HTTPException(404, "Equipment profile not found")
    copy = EquipmentProfile(
        name=f"{src.name} (custom copy)", manufacturer=src.manufacturer, aperture_mm=src.aperture_mm,
        focal_length_mm=src.focal_length_mm, fov_deg=src.fov_deg, fov_definition=src.fov_definition,
        wide_fov_deg=src.wide_fov_deg, sensor=src.sensor, mount_type=src.mount_type, source_url=src.source_url,
        notes=f"Copied from {src.name}. Edited values are not manufacturer-verified.",
        is_verified=False, is_preset=False,
    )
    db.add(copy)
    db.commit()
    return _equipment_out(copy)


@router.delete("/equipment/{equipment_id}", status_code=204)
def delete_equipment(equipment_id: str, db: Session = Depends(get_db)) -> Response:
    eq = _custom_or_403(db, equipment_id)
    in_use = db.scalar(select(func.count()).select_from(ObservingSession).where(ObservingSession.equipment_id == equipment_id))
    if in_use:
        raise HTTPException(409, f"Equipment is used by {in_use} saved session(s).")
    db.delete(eq)
    db.commit()
    return Response(status_code=204)


# ---- sessions ------------------------------------------------------------------

SessionStatus = Literal["planned", "completed", "cancelled"]


class SessionIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=160)
    local_night_date: date
    location_id: str | None = None
    equipment_id: str | None = None
    notes: str | None = Field(None, max_length=5000)


class SessionPatch(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=160)
    local_night_date: date | None = None
    location_id: str | None = None
    equipment_id: str | None = None
    status: SessionStatus | None = None
    notes: str | None = Field(None, max_length=5000)


class SessionTargetIn(BaseModel):
    target_id: str
    planned_start_utc: datetime | None = None
    planned_end_utc: datetime | None = None
    notes: str | None = Field(None, max_length=2000)


class SessionTargetPatch(BaseModel):
    planned_start_utc: datetime | None = None
    planned_end_utc: datetime | None = None
    notes: str | None = Field(None, max_length=2000)


class ReorderIn(BaseModel):
    session_target_ids: list[str]


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        raise HTTPException(422, "Timestamps must include a timezone (use UTC, e.g. 2026-11-02T03:00:00Z).")
    return iso_utc(dt.timestamp())


def _session_target_out(st: SessionTarget) -> dict[str, Any]:
    t = targets.lookup(st.target_id)  # deep-sky catalog id or a curated ``var:<slug>`` star
    return {
        "id": st.id, "target_id": st.target_id, "sort_order": st.sort_order,
        "planned_start_utc": st.planned_start_utc, "planned_end_utc": st.planned_end_utc, "notes": st.notes,
        "target": None if t is None else {k: t[k] for k in ("id", "primary_designation", "name", "category", "kind",
                                                             "constellation", "ra_deg", "dec_deg")},
    }


def _session_out(s: ObservingSession, with_targets: bool = True,
                 info: tuple[list[dict[str, Any]], list[str]] | None = None) -> dict[str, Any]:
    out = {c: getattr(s, c) for c in ("id", "title", "location_id", "equipment_id", "local_night_date", "start_utc",
                                      "end_utc", "status", "notes", "source", "created_at", "updated_at")}
    out["capture_sets"], out["not_shot"] = info or session_capture_info(object_session(s), s)
    out["target_count"] = len(s.targets)
    if with_targets:
        out["targets"] = [_session_target_out(st) for st in sorted(s.targets, key=lambda x: x.sort_order)]
    return out


def _check_refs(db: Session, location_id: str | None, equipment_id: str | None) -> None:
    if location_id and db.get(ObservingLocation, location_id) is None:
        raise HTTPException(422, "location_id does not exist")
    if equipment_id and db.get(EquipmentProfile, equipment_id) is None:
        raise HTTPException(422, "equipment_id does not exist")


def _get_session(db: Session, session_id: str) -> ObservingSession:
    s = db.get(ObservingSession, session_id)
    if s is None:
        raise HTTPException(404, "Session not found")
    return s


@router.get("/sessions")
def list_sessions(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.scalars(select(ObservingSession).order_by(ObservingSession.local_night_date.desc(),
                                                        ObservingSession.created_at.desc()))
    rows = list(rows)
    infos = capture_info(db, [s.id for s in rows])
    return [_session_out(s, with_targets=True, info=infos[s.id]) for s in rows]


@router.post("/sessions", status_code=201)
def create_session(body: SessionIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    _check_refs(db, body.location_id, body.equipment_id)
    s = ObservingSession(title=body.title, local_night_date=body.local_night_date.isoformat(),
                         location_id=body.location_id, equipment_id=body.equipment_id, notes=body.notes)
    db.add(s)
    db.commit()
    return _session_out(s)


@router.get("/sessions/{session_id}")
def get_session(session_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    return _session_out(_get_session(db, session_id))


@router.patch("/sessions/{session_id}")
def update_session(session_id: str, body: SessionPatch, db: Session = Depends(get_db)) -> dict[str, Any]:
    s = _get_session(db, session_id)
    data = body.model_dump(exclude_unset=True)
    _check_refs(db, data.get("location_id"), data.get("equipment_id"))
    for k, v in data.items():
        setattr(s, k, v.isoformat() if isinstance(v, date) else v)
    db.commit()
    db.refresh(s)
    return _session_out(s)


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: str, db: Session = Depends(get_db)) -> Response:
    s = _get_session(db, session_id)
    if db.scalar(select(func.count()).select_from(CaptureSet).where(CaptureSet.session_id == session_id)):
        raise HTTPException(409, "This night has imported captures, so it can't be deleted.")
    db.delete(s)
    db.commit()
    return Response(status_code=204)


@router.post("/sessions/{session_id}/targets", status_code=201)
def add_session_target(session_id: str, body: SessionTargetIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    s = _get_session(db, session_id)
    if targets.lookup(body.target_id) is None:
        raise HTTPException(422, f"Unknown target {body.target_id!r}")
    if any(st.target_id == body.target_id for st in s.targets):
        raise HTTPException(409, "Target is already in this session")
    order = max((st.sort_order for st in s.targets), default=-1) + 1
    st = SessionTarget(session_id=s.id, target_id=body.target_id, sort_order=order, notes=body.notes,
                       planned_start_utc=_iso(body.planned_start_utc), planned_end_utc=_iso(body.planned_end_utc))
    db.add(st)
    try:
        db.commit()
    except IntegrityError:  # pragma: no cover
        db.rollback()
        raise HTTPException(409, "Could not add target")
    db.refresh(s)
    return _session_out(s)


@router.patch("/sessions/{session_id}/targets/{session_target_id}")
def update_session_target(session_id: str, session_target_id: str, body: SessionTargetPatch,
                          db: Session = Depends(get_db)) -> dict[str, Any]:
    s = _get_session(db, session_id)
    st = next((x for x in s.targets if x.id == session_target_id), None)
    if st is None:
        raise HTTPException(404, "Session target not found")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(st, k, _iso(v) if isinstance(v, datetime) else v)
    db.commit()
    db.refresh(s)
    return _session_out(s)


@router.delete("/sessions/{session_id}/targets/{session_target_id}")
def remove_session_target(session_id: str, session_target_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    s = _get_session(db, session_id)
    st = next((x for x in s.targets if x.id == session_target_id), None)
    if st is None:
        raise HTTPException(404, "Session target not found")
    s.targets.remove(st)
    for i, x in enumerate(sorted(s.targets, key=lambda y: y.sort_order)):
        x.sort_order = i
    db.commit()
    db.refresh(s)
    return _session_out(s)


@router.put("/sessions/{session_id}/targets/order")
def reorder_session_targets(session_id: str, body: ReorderIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    s = _get_session(db, session_id)
    current = {st.id: st for st in s.targets}
    if sorted(body.session_target_ids) != sorted(current):
        raise HTTPException(422, "session_target_ids must list every target in the session exactly once")
    for i, sid in enumerate(body.session_target_ids):
        current[sid].sort_order = i
    db.commit()
    db.refresh(s)
    return _session_out(s)
