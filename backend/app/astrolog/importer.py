"""Header-based import: turn parsed FITS/CR2 headers into nights, capture sets, frames and stacks.

Grouping and matching are pure functions; ``commit_import`` writes one import inside the caller's
DB transaction. Coordinates read from files (SITELAT/SITELONG) are used only in memory, inside the
request, to pick a timezone and match a saved location; they are never stored, logged or returned
(the rounded ``suggest_location`` output is the single sanctioned exception, spec §7a).
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import math
import re
import statistics
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from pathlib import PurePosixPath
from typing import Any, Iterable, Literal, Protocol
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import catalog, geo
from app.api import _equipment_out  # the API's profile shape is the snapshot shape
from app.db import EquipmentProfile, ObservingLocation, ObservingSession

from .headers import (
    ExifInfo,
    FitsInfo,
    HeaderError,
    is_ignored,
    normalize_object,
    parse_cr2_exif,
    parse_fits_header,
    parse_stack_filename,
)
from .models import CaptureFrame, CaptureSet, LibraryTarget, Stack

MATCH_RADIUS_KM = 5.0
EARTH_RADIUS_KM = 6371.0088
UNSORTED_KEY = "unsorted"
SEESTAR_ID = "seestar-s30"
CANON_ID = "canon-t3-18-55"
_CANON_T3 = re.compile(r"\bREBEL T3\b", re.IGNORECASE)  # T3 only, not T3i (a different camera)


class ImportRequestError(Exception):
    """A request-level problem with a commit (mapped to HTTP 422)."""


# ---- targets ---------------------------------------------------------------------

@dataclass(frozen=True)
class TargetRef:
    library_key: str
    catalog_target_id: str | None
    display_name: str
    kind: Literal["catalog", "custom", "unsorted"]

    def out(self) -> dict[str, Any]:
        return {"library_key": self.library_key, "catalog_target_id": self.catalog_target_id,
                "display_name": self.display_name, "kind": self.kind}


UNSORTED = TargetRef(UNSORTED_KEY, None, "Unsorted", "unsorted")


@lru_cache(maxsize=1)
def _catalog_index() -> dict[str, str]:
    """normalize_object(id | primary designation | alias) -> catalog target id (first wins)."""
    idx: dict[str, str] = {}
    for t in catalog.all_targets():
        for name in [t["id"], t["primary_designation"], *t.get("aliases", [])]:
            idx.setdefault(normalize_object(name), t["id"])
    return idx


def resolve_target(name: str | None) -> TargetRef:
    """OBJECT (or a user-given set name) -> catalog target if known, else a custom target."""
    clean = (name or "").strip()[:160]
    if not clean:
        return UNSORTED
    norm = normalize_object(clean)
    cid = _catalog_index().get(norm)
    if cid is not None:
        return TargetRef(f"catalog:{cid}", cid, catalog.get_target(cid)["primary_designation"], "catalog")
    return TargetRef(f"custom:{norm}", None, clean, "custom")


# ---- parsing items ------------------------------------------------------------------

class ItemLike(Protocol):
    path: str
    kind: str
    header_b64: str


@dataclass
class Parsed:
    path: str
    filename: str
    source: Literal["fits", "cr2"]
    fits: FitsInfo | None = None
    exif: ExifInfo | None = None

    @property
    def is_stack(self) -> bool:
        return self.fits is not None and self.fits.kind == "stack"

    def site(self) -> tuple[float, float] | None:
        """Header site coordinates, validated; for in-request use only."""
        f = self.fits
        if f is None or f.site_lat is None or f.site_lon is None:
            return None
        lat, lon = f.site_lat, f.site_lon
        if not (math.isfinite(lat) and math.isfinite(lon)) or abs(lat) > 90 or not (-180 <= lon <= 360):
            return None
        return lat, (lon - 360 if lon > 180 else lon)


def _safe_reason(err: HeaderError) -> str:
    # Parser detail after ':' can echo header cards; keep only the fixed leading phrase.
    return err.reason.split(":", 1)[0].strip() or "unreadable header"


def parse_items(items: Iterable[ItemLike]) -> tuple[list[Parsed], list[dict[str, str]]]:
    parsed: list[Parsed] = []
    skipped: list[dict[str, str]] = []

    def skip(path: str, reason: str) -> None:
        skipped.append({"path": path, "reason": reason})

    for it in items:
        if is_ignored(it.path):
            skip(it.path, "ignored: working or non-image file")
            continue
        try:
            data = base64.b64decode(it.header_b64, validate=True)
        except (binascii.Error, ValueError):
            skip(it.path, "header data is not valid base64")
            continue
        filename = PurePosixPath(it.path.replace("\\", "/")).name
        try:
            if it.kind == "fits":
                info = parse_fits_header(data)
                if info.kind == "other":
                    skip(it.path, "not a light frame or stack (IMAGETYP is not Light)")
                    continue
                if info.kind == "sub" and info.date_obs_utc is None:
                    skip(it.path, "missing DATE-OBS")
                    continue
                if info.kind == "sub" and not (info.exptime_s and info.exptime_s > 0):
                    skip(it.path, "missing EXPTIME")
                    continue
                parsed.append(Parsed(it.path, filename, "fits", fits=info))
            else:
                exif = parse_cr2_exif(data)
                if exif.captured_local is None:
                    skip(it.path, "missing capture time (DateTimeOriginal)")
                    continue
                if not (exif.exposure_s and exif.exposure_s > 0):
                    skip(it.path, "missing exposure time")
                    continue
                parsed.append(Parsed(it.path, filename, "cr2", exif=exif))
        except HeaderError as err:
            skip(it.path, _safe_reason(err))
        except Exception:  # one odd file must never sink the batch (Review Focus 2); no detail echoed
            skip(it.path, "unreadable header")
    return parsed, skipped


# ---- time and night ------------------------------------------------------------------

def _night_of_local(local: datetime) -> date:
    """Phase 1 rule: local noon -> next noon belongs to the evening's date."""
    return local.date() if local.hour >= 12 else local.date() - timedelta(days=1)


def night_date_for(utc: datetime, tz: str) -> date:
    return _night_of_local(utc.astimezone(ZoneInfo(tz)))


def iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


# ---- location matching ----------------------------------------------------------------

class LocationLike(Protocol):
    id: str
    label: str
    latitude_deg: float
    longitude_deg: float


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def match_location(lat: float, lon: float, locations: Iterable[LocationLike]):
    """Saved locations within 5 km, closest first; returns (closest | None, candidates).

    ``distance_km`` is rounded to whole kilometres so candidates cannot be used to triangulate
    the header position more finely than the ~1 km the spec allows.
    """
    near = sorted(((haversine_km(lat, lon, l.latitude_deg, l.longitude_deg), l) for l in locations),
                  key=lambda x: x[0])
    near = [(d, l) for d, l in near if d <= MATCH_RADIUS_KM]
    cands = [{"id": l.id, "label": l.label, "distance_km": float(round(d))} for d, l in near]
    return (near[0][1] if near else None), cands


def resolve_batch_location(parsed: list[Parsed], locations: list[ObservingLocation]):
    """Auto-match the batch to one saved location. Returns (location | None, candidates).

    Matches only when every file with site coordinates agrees on the same saved location and the
    batch has no Canon files (those carry no coordinates and need an explicit choice).
    """
    if not parsed:
        return None, []
    sites = {p.site() for p in parsed} - {None}
    best: dict[str, dict[str, Any]] = {}
    matched: set[str] = set()
    all_matched = bool(sites)
    for lat, lon in sites:
        m, cands = match_location(lat, lon, locations)
        all_matched &= m is not None
        if m is not None:
            matched.add(m.id)
        for c in cands:
            if c["id"] not in best or c["distance_km"] < best[c["id"]]["distance_km"]:
                best[c["id"]] = c
    cands = sorted(best.values(), key=lambda c: (c["distance_km"], c["label"]))
    has_canon = any(p.source == "cr2" for p in parsed)
    if all_matched and len(matched) == 1 and not has_canon:
        loc = next(l for l in locations if l.id in matched)
        return loc, cands
    return None, cands


def suggest_location(parsed: list[Parsed]) -> dict[str, Any] | None:
    """Median header site rounded to 0.01 degrees (~1 km); the only coordinate-derived output."""
    sites = [s for s in (p.site() for p in parsed) if s is not None]
    if not sites:
        return None
    lat = round(statistics.median(s[0] for s in sites), 2)
    lon = round(statistics.median(s[1] for s in sites), 2)
    return {"latitude_deg": lat, "longitude_deg": lon, "timezone": geo.timezone_at(lat, lon)}


# ---- frames and groups --------------------------------------------------------------------

def _hash_key(prefix: str, parts: Iterable[Any]) -> str:
    raw = "\x1f".join("" if p is None else str(p) for p in parts)
    return f"{prefix}:{hashlib.sha256(raw.encode('utf-8')).hexdigest()}"


def frame_dedup_key(info: FitsInfo | ExifInfo, filename: str) -> str:
    """Stable identity of a sub-frame: (camera identity, capture time, exposure, filename), hashed.

    Hashing keeps any serial number in TELESCOP out of the stored key. Canon frames use the raw
    camera clock, so re-importing with a different clock offset does not duplicate frames.
    """
    if isinstance(info, FitsInfo):
        ident = info.telescop or info.instrument or info.creator
        when = info.date_obs_utc.isoformat() if info.date_obs_utc else None
        return _hash_key("fits", (ident, when, info.exptime_s, filename))
    when = info.captured_local.isoformat() if info.captured_local else None
    return _hash_key("cr2", (info.model, when, info.exposure_s, filename))


def stack_dedup_key(info: FitsInfo, filename: str) -> str:
    when = info.date_obs_utc.isoformat() if info.date_obs_utc else None
    return _hash_key("stack", (filename, info.object, when, info.stack_count, info.livetime_s,
                               info.expstart_jd, info.expend_jd))


def fits_device(info: FitsInfo) -> str:
    return (info.instrument or info.creator or "Unknown FITS camera")[:64]


def equipment_id_for(device: str) -> str | None:
    if device.strip().casefold() == "seestar s30":
        return SEESTAR_ID
    if _CANON_T3.search(device):
        return CANON_ID
    return None


@dataclass
class Frame:
    parsed: Parsed
    device: str
    target: TargetRef
    utc: datetime | None
    night_date: date | None
    exptime_s: float
    filter: str | None
    gain: float | None
    ccd_temp_c: float | None
    dedup_key: str


@dataclass
class Group:
    night_date: date | None
    device: str
    target: TargetRef
    is_canon: bool
    frames: list[Frame] = field(default_factory=list)

    def sort_key(self) -> tuple:
        first = self.first_utc
        return (self.night_date.isoformat() if self.night_date else "9999", self.device,
                self.target.display_name, iso_z(first) if first else "")

    @property
    def first_utc(self) -> datetime | None:
        ts = [f.utc for f in self.frames if f.utc]
        return min(ts) if ts else None

    @property
    def last_utc(self) -> datetime | None:
        ts = [f.utc for f in self.frames if f.utc]
        return max(ts) if ts else None

    def summary(self) -> dict[str, Any]:
        exps = {f.exptime_s for f in self.frames}
        temps = [f.ccd_temp_c for f in self.frames if f.ccd_temp_c is not None]
        first, last = self.first_utc, self.last_utc
        return {
            "night_date": self.night_date.isoformat() if self.night_date else None,
            "device": self.device,
            "target": self.target.out(),
            "frames": len(self.frames),
            "exptime_s": exps.pop() if len(exps) == 1 else None,
            "captured_s": float(sum(f.exptime_s for f in self.frames)),
            "first_utc": iso_z(first) if first else None,
            "last_utc": iso_z(last) if last else None,
            "filters": sorted({f.filter for f in self.frames if f.filter}),
            "gains": sorted({f.gain for f in self.frames if f.gain is not None}),
            "ccd_temp_range": [min(temps), max(temps)] if temps else None,
        }


class _TzResolver:
    """Timezone per item: the chosen/matched location's, else the header site's (FITS only).

    Header-derived timezones are memoised per request only (never in a module-level cache).
    """

    def __init__(self, location: ObservingLocation | None):
        self.location = location
        self._memo: dict[tuple[float, float], str | None] = {}

    def __call__(self, p: Parsed) -> str | None:
        if self.location is not None:
            return self.location.timezone
        site = p.site()
        if site is None:
            return None
        if site not in self._memo:
            self._memo[site] = geo.timezone_at(*site)
        return self._memo[site]


def _frame(p: Parsed, tz: str | None, clock_offset_minutes: int) -> Frame:
    if p.fits is not None:
        f = p.fits
        return Frame(p, fits_device(f), resolve_target(f.object), f.date_obs_utc,
                     night_date_for(f.date_obs_utc, tz) if tz else None, float(f.exptime_s), f.filter, f.gain,
                     f.ccd_temp_c, frame_dedup_key(f, p.filename))
    e = p.exif
    local = e.captured_local + timedelta(minutes=clock_offset_minutes)
    utc = local.replace(tzinfo=ZoneInfo(tz)).astimezone(timezone.utc) if tz else None
    # A camera clock set to local time gives the night directly, with or without a timezone.
    return Frame(p, (e.model or "Unknown camera")[:64], UNSORTED, utc, _night_of_local(local),
                 float(e.exposure_s), None, None, None, frame_dedup_key(e, p.filename))


def group_items(infos: list[Parsed], location: ObservingLocation | None, clock_offset_minutes: int = 0) -> list[Group]:
    """Group sub-frames (FITS subs and CR2s) by (night, device, target), in a deterministic order."""
    tz_of = _TzResolver(location)
    groups: dict[tuple, Group] = {}
    seen: set[str] = set()
    for p in infos:
        if p.is_stack:
            continue
        fr = _frame(p, tz_of(p), clock_offset_minutes)
        if fr.dedup_key in seen:  # the same file twice in one batch counts once
            continue
        seen.add(fr.dedup_key)
        key = (fr.night_date, fr.device, fr.target.library_key)
        g = groups.get(key)
        if g is None:
            g = groups[key] = Group(fr.night_date, fr.device, fr.target, p.source == "cr2")
        g.frames.append(fr)
    return sorted(groups.values(), key=Group.sort_key)


@dataclass
class StackInfo:
    parsed: Parsed
    target: TargetRef
    night_date: date | None
    stack_count: int | None
    livetime_s: float | None
    exptime_s: float | None
    provenance: Literal["header", "filename"]
    dedup_key: str

    def out(self) -> dict[str, Any]:
        f = self.parsed.fits
        return {"path": self.parsed.path, "source_filename": self.parsed.filename,
                "night_date": self.night_date.isoformat() if self.night_date else None,
                "target": self.target.out(), "stack_count": self.stack_count, "livetime_s": self.livetime_s,
                "exptime_s": self.exptime_s, "expstart_jd": f.expstart_jd, "expend_jd": f.expend_jd,
                "program": f.program, "provenance": self.provenance}


def stack_infos(infos: list[Parsed], location: ObservingLocation | None) -> list[StackInfo]:
    tz_of = _TzResolver(location)
    out: list[StackInfo] = []
    seen: set[str] = set()
    for p in infos:
        if not p.is_stack or stack_dedup_key(p.fits, p.filename) in seen:
            continue
        seen.add(stack_dedup_key(p.fits, p.filename))
        f = p.fits
        tz = tz_of(p)
        count, live, exp, prov = f.stack_count, f.livetime_s, f.exptime_s, "header"
        if count is None and live is None:
            parsed_name = parse_stack_filename(p.filename)
            if parsed_name is not None:
                (count, exp), prov = parsed_name, "filename"
        night = night_date_for(f.date_obs_utc, tz) if (tz and f.date_obs_utc) else None
        out.append(StackInfo(p, resolve_target(f.object), night, count, live, exp, prov,
                             stack_dedup_key(f, p.filename)))
    return sorted(out, key=lambda s: (s.target.display_name, s.parsed.filename))


# ---- database helpers ---------------------------------------------------------------------

def existing_keys(db: Session, model, keys: Iterable[str]) -> set[str]:
    keys = list(set(keys))
    found: set[str] = set()
    for i in range(0, len(keys), 500):
        found |= set(db.scalars(select(model.dedup_key).where(model.dedup_key.in_(keys[i:i + 500]))))
    return found


def import_session_for(db: Session, night: date, location_id: str) -> ObservingSession | None:
    """The session an earlier import created/attached for this (night, location), if any."""
    return db.scalars(select(ObservingSession).where(
        ObservingSession.local_night_date == night.isoformat(),
        ObservingSession.location_id == location_id,
        ObservingSession.source.in_(("imported", "both")),
    ).order_by(ObservingSession.created_at)).first()


def plan_candidates(db: Session, night: date, location_id: str) -> list[ObservingSession]:
    return list(db.scalars(select(ObservingSession).where(
        ObservingSession.local_night_date == night.isoformat(),
        ObservingSession.source == "planned",
        (ObservingSession.location_id == location_id) | (ObservingSession.location_id.is_(None)),
    ).order_by(ObservingSession.created_at)))


def plan_ids_for(db: Session, night: date | None, location_id: str | None) -> list[str]:
    """Planned sessions this night would attach to (empty until the location is known)."""
    if night is None or location_id is None or import_session_for(db, night, location_id):
        return []
    return [s.id for s in plan_candidates(db, night, location_id)]


def _night_title(night: date) -> str:
    return f"Night of {night.day} {night.strftime('%b %Y')}"


def _get_or_create_target(db: Session, ref: TargetRef, cache: dict[str, LibraryTarget]) -> LibraryTarget:
    if ref.library_key in cache:
        return cache[ref.library_key]
    lt = db.scalars(select(LibraryTarget).where(LibraryTarget.normalized_key == ref.library_key)).first()
    if lt is None:
        lt = LibraryTarget(catalog_target_id=ref.catalog_target_id, normalized_key=ref.library_key, kind=ref.kind,
                           custom_name=ref.display_name if ref.kind == "custom" else None)
        db.add(lt)
        db.flush()
    cache[ref.library_key] = lt
    return lt


def _snapshot(db: Session, device: str) -> tuple[str | None, dict[str, Any] | None]:
    eq_id = equipment_id_for(device)
    eq = db.get(EquipmentProfile, eq_id) if eq_id else None
    return (eq.id, _equipment_out(eq)) if eq is not None else (None, None)


class _Sessions:
    """Resolves the one session per (night, location) for a commit, attaching to plans per §7a."""

    def __init__(self, db: Session, location: ObservingLocation, plan_session_id: str | None):
        self.db, self.location, self.plan_session_id = db, location, plan_session_id
        self.by_night: dict[date, ObservingSession] = {}
        self.plan_used = False

    def get(self, night: date) -> ObservingSession:
        if night in self.by_night:
            return self.by_night[night]
        db, loc = self.db, self.location
        s = import_session_for(db, night, loc.id)
        if s is not None:
            self.plan_used |= s.id == self.plan_session_id
        else:
            cands = plan_candidates(db, night, loc.id)
            chosen = [c for c in cands if c.id == self.plan_session_id]
            if len(cands) > 1 and not chosen:
                raise ImportRequestError(f"Several planned sessions match the night of {night.isoformat()}; "
                                   "choose one with plan_session_id.")
            s = chosen[0] if chosen else (cands[0] if len(cands) == 1 else None)
            if s is not None:
                self.plan_used |= s.id == self.plan_session_id
                s.status, s.source = "completed", "both"
                if s.location_id is None:
                    s.location_id = loc.id
            else:
                s = ObservingSession(title=_night_title(night), local_night_date=night.isoformat(),
                                     location_id=loc.id, status="completed", source="imported")
                db.add(s)
            db.flush()
        self.by_night[night] = s
        return s

    def existing(self, night: date | None) -> ObservingSession | None:
        if night is None:
            return None
        return self.by_night.get(night) or import_session_for(self.db, night, self.location.id)


def _link_plan_target(s: ObservingSession, lt: LibraryTarget) -> None:
    if lt.catalog_target_id is None:
        return
    for st in s.targets:
        if st.target_id == lt.catalog_target_id and st.library_target_id is None:
            st.library_target_id = lt.id


def apply_overrides(groups: list[Group], canon_set_names: dict[int, str], unsorted_groups: set[int]) -> None:
    n = len(groups)
    for i in set(canon_set_names) | unsorted_groups:
        if not 0 <= i < n:
            raise ImportRequestError(f"Group index {i} does not exist (this import has {n} group(s)).")
    for i, name in canon_set_names.items():
        if not groups[i].is_canon:
            raise ImportRequestError(f"Group {i} is not a Canon set; only Canon sets can be named.")
        if i in unsorted_groups:
            raise ImportRequestError(f"Group {i} cannot be both named and moved to Unsorted.")
        if not name.strip():
            raise ImportRequestError(f"Group {i} needs a non-empty name.")
        groups[i].target = resolve_target(name)
    for i in unsorted_groups:
        groups[i].target = UNSORTED


def commit_import(db: Session, parsed: list[Parsed], location: ObservingLocation, *, clock_offset_minutes: int = 0,
                  plan_session_id: str | None = None, canon_set_names: dict[int, str] | None = None,
                  unsorted_groups: Iterable[int] = ()) -> dict[str, Any]:
    """Write one import (caller commits or rolls back). Raises ImportRequestError for request problems."""
    groups = group_items(parsed, location, clock_offset_minutes)
    apply_overrides(groups, dict(canon_set_names or {}), set(unsorted_groups))
    sessions = _Sessions(db, location, plan_session_id)
    targets: dict[str, LibraryTarget] = {}
    sets: dict[tuple[str, str, str], CaptureSet] = {}
    known = existing_keys(db, CaptureFrame, (f.dedup_key for g in groups for f in g.frames))
    inserted_frames, session_ids = 0, []

    for g in groups:
        s = sessions.get(g.night_date)
        if s.id not in session_ids:
            session_ids.append(s.id)
        lt = _get_or_create_target(db, g.target, targets)
        _link_plan_target(s, lt)
        key = (s.id, lt.id, g.device)
        cs = sets.get(key) or db.scalars(select(CaptureSet).where(
            CaptureSet.session_id == s.id, CaptureSet.library_target_id == lt.id, CaptureSet.device == g.device)).first()
        if cs is None:
            eq_id, snap = _snapshot(db, g.device)
            cs = CaptureSet(session_id=s.id, library_target_id=lt.id, device=g.device, equipment_id=eq_id,
                            equipment_snapshot=snap)
            db.add(cs)
            db.flush()
        sets[key] = cs
        for f in g.frames:
            if f.dedup_key in known:
                continue
            known.add(f.dedup_key)
            db.add(CaptureFrame(capture_set_id=cs.id, date_obs_utc=iso_z(f.utc), exptime_s=f.exptime_s,
                                filter=f.filter, gain=f.gain, ccd_temp_c=f.ccd_temp_c,
                                source_filename=f.parsed.filename, dedup_key=f.dedup_key))
            inserted_frames += 1

    if plan_session_id is not None and not sessions.plan_used:
        raise ImportRequestError("plan_session_id is not a planned session for any night in this import.")

    stacks = stack_infos(parsed, location)
    known_stacks = existing_keys(db, Stack, (st.dedup_key for st in stacks))
    inserted_stacks = 0
    for st in stacks:
        if st.dedup_key in known_stacks:
            continue
        known_stacks.add(st.dedup_key)
        f = st.parsed.fits
        s = sessions.existing(st.night_date)
        db.add(Stack(library_target_id=_get_or_create_target(db, st.target, targets).id,
                     session_id=s.id if s else None, source_filename=st.parsed.filename,
                     stack_count=st.stack_count, livetime_s=st.livetime_s, exptime_s=st.exptime_s,
                     expstart_jd=f.expstart_jd, expend_jd=f.expend_jd, program=f.program[:120] if f.program else None,
                     provenance=st.provenance, dedup_key=st.dedup_key))
        inserted_stacks += 1
    db.flush()
    return {"session_ids": session_ids, "inserted_frames": inserted_frames, "inserted_stacks": inserted_stacks}
