"""Library queries: per-target summaries, the headline integration, plan vs actual.

Rules (spec 7a): the headline is the integration of the ONE stack linked to the current final
picture (``LIVETIME``, else ``STACKCNT`` x ``EXPTIME``, else the ``<N>x<T>sec`` filename);
otherwise it is the captured time labelled "captured". Stacks are never summed. Unknown values
stay ``None``; nothing is estimated. Header site coordinates are never stored, so none can leak.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import catalog
from app.db import ObservingSession, SessionTarget

from .headers import parse_stack_filename
from .models import CaptureFrame, CaptureSet, FinalImage, LibraryTarget, Stack

UNSORTED_NAME = "Unsorted"
UNIX_JD_EPOCH = 2440587.5


def display_name(lt: LibraryTarget) -> str:
    if lt.kind == "unsorted":
        return UNSORTED_NAME
    if lt.kind == "catalog" and lt.catalog_target_id:
        t = catalog.get_target(lt.catalog_target_id)
        if t is not None:
            return t["name"]
    return lt.custom_name or lt.catalog_target_id or UNSORTED_NAME


def _category(lt: LibraryTarget) -> str | None:
    if lt.catalog_target_id:
        t = catalog.get_target(lt.catalog_target_id)
        return t["category"] if t else None
    return None


def summary(lt: LibraryTarget) -> dict[str, Any]:
    return {"id": lt.id, "display_name": display_name(lt), "kind": lt.kind,
            "catalog_target_id": lt.catalog_target_id, "custom_name": lt.custom_name, "category": _category(lt)}


def stack_seconds(st: Stack) -> tuple[float | None, str]:
    """Integration of one stack and where it came from; (None, ...) when nothing is known."""
    if st.livetime_s is not None:
        return float(st.livetime_s), st.provenance
    if st.stack_count is not None and st.exptime_s is not None:
        return float(st.stack_count) * float(st.exptime_s), st.provenance
    parsed = parse_stack_filename(st.source_filename)
    if parsed:
        return parsed[0] * parsed[1], "filename"
    return None, st.provenance


def stack_out(st: Stack) -> dict[str, Any]:
    secs, prov = stack_seconds(st)
    return {"id": st.id, "source_filename": st.source_filename, "stack_count": st.stack_count,
            "livetime_s": st.livetime_s, "exptime_s": st.exptime_s, "expstart_jd": st.expstart_jd,
            "expend_jd": st.expend_jd, "program": st.program, "provenance": st.provenance,
            "integration_s": secs, "integration_provenance": prov}


def _headline(captured_s: float | None, linked: Stack | None, latest: Stack | None = None) -> dict[str, Any]:
    """Linked stack; else (only when the target has no frames) its latest stack; else captured."""
    for st in (linked, latest if captured_s is None else None):
        if st is not None:
            secs, prov = stack_seconds(st)
            if secs is not None:
                return {"seconds": secs, "label": "stack", "provenance": prov}
    if captured_s is None:
        return {"seconds": None, "label": "captured", "provenance": "frames"}
    return {"seconds": captured_s, "label": "captured", "provenance": "frames"}


def _current_images(db: Session) -> dict[str, FinalImage]:
    return {i.library_target_id: i for i in db.scalars(select(FinalImage).where(FinalImage.is_current.is_(True)))}


def _linked_stacks(db: Session, images: dict[str, FinalImage]) -> dict[str, Stack]:
    ids = {i.stack_id for i in images.values() if i.stack_id}
    if not ids:
        return {}
    by_id = {s.id: s for s in db.scalars(select(Stack).where(Stack.id.in_(ids)))}
    return {tid: by_id[i.stack_id] for tid, i in images.items()
            if i.stack_id in by_id and by_id[i.stack_id].library_target_id == tid}


def _latest_stacks(db: Session) -> dict[str, Stack]:
    out: dict[str, Stack] = {}
    for st in db.scalars(select(Stack).order_by(Stack.imported_at.desc(), Stack.id)):
        out.setdefault(st.library_target_id, st)
    return out


def _captured(db: Session) -> dict[str, dict[str, Any]]:
    q = (select(CaptureSet.library_target_id, func.coalesce(func.sum(CaptureFrame.exptime_s), 0.0),
                func.count(CaptureFrame.id), func.count(func.distinct(CaptureSet.session_id)),
                func.max(CaptureFrame.date_obs_utc))
         .join(CaptureFrame, CaptureFrame.capture_set_id == CaptureSet.id)
         .group_by(CaptureSet.library_target_id))
    return {tid: {"captured_s": float(s), "frames": n, "nights": nights, "last": last}
            for tid, s, n, nights, last in db.execute(q)}


def _thumb_url(img: FinalImage | None) -> str | None:
    return f"/api/astrolog/images/{img.id}/thumb" if img else None


def library(db: Session) -> list[dict[str, Any]]:
    cap, images = _captured(db), _current_images(db)
    stacks, latest = _linked_stacks(db, images), _latest_stacks(db)
    rows = []
    for lt in db.scalars(select(LibraryTarget)):
        c = cap.get(lt.id)
        if c is None and lt.id not in images and lt.id not in latest:
            continue  # no frames, no stack, no picture: nothing to show
        cs = c["captured_s"] if c else None  # no frames: captured time is unknown, never 0
        rows.append(({**summary(lt), "thumb_url": _thumb_url(images.get(lt.id)),
                      "headline": _headline(cs, stacks.get(lt.id), latest.get(lt.id)),
                      "captured_s": cs, "nights": c["nights"] if c else 0},
                     (c or {}).get("last") or "", lt.created_at))
    rows.sort(key=lambda r: (r[1], r[2]), reverse=True)
    return [r[0] for r in rows]


def history(db: Session) -> dict[str, dict[str, Any]]:
    cap, images = _captured(db), _current_images(db)
    stacks, latest = _linked_stacks(db, images), _latest_stacks(db)
    out: dict[str, dict[str, Any]] = {}
    for lt in db.scalars(select(LibraryTarget).where(LibraryTarget.catalog_target_id.is_not(None))):
        c = cap.get(lt.id)
        if c is None and lt.id not in latest and lt.id not in stacks:
            continue
        h = _headline(c["captured_s"] if c else None, stacks.get(lt.id), latest.get(lt.id))
        if h["seconds"] is not None:
            out[lt.catalog_target_id] = {"seconds": h["seconds"], "label": h["label"]}
    return out


def _jd(iso_utc: list[str]) -> np.ndarray:
    ts = np.array([datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp()
                   for s in iso_utc])
    return ts / 86400.0 + UNIX_JD_EPOCH


def percent_used(stack: Stack | None, frame_times: list[str]) -> float | None:
    if stack is None or not stack.stack_count or stack.expstart_jd is None or stack.expend_jd is None:
        return None
    if not frame_times:
        return None
    jd = _jd(frame_times)
    n = int(np.count_nonzero((jd >= stack.expstart_jd) & (jd <= stack.expend_jd)))
    return round(100.0 * stack.stack_count / n, 2) if n else None


def _facts(frames: list[CaptureFrame], devices: list[str]) -> list[dict[str, Any]]:
    def distinct(vals: list[Any]) -> list[Any]:
        return sorted({v for v in vals if v is not None})

    def fmt(vals: list[Any]) -> str | None:
        return ", ".join(f"{v:g}" if isinstance(v, float) else str(v) for v in vals) if vals else None

    filters, gains = distinct([f.filter for f in frames]), distinct([f.gain for f in frames])
    temps = distinct([f.ccd_temp_c for f in frames])
    temp = None if not temps else (f"{temps[0]:g}" if len(temps) == 1 else f"{temps[0]:g} to {temps[-1]:g}")
    facts = [("Filter", fmt(filters), "FILTER"), ("Gain", fmt(gains), "GAIN"),
             ("Sensor temperature (C)", temp, "CCD-TEMP"), ("Camera", fmt(sorted(set(devices))), "INSTRUME")]
    return [{"label": a, "value": v, "source_key": k} for a, v, k in facts if v is not None]


def target_page(db: Session, lt: LibraryTarget) -> dict[str, Any]:
    from .previews import suggest_stack_id

    img = db.scalars(select(FinalImage).where(FinalImage.library_target_id == lt.id,
                                              FinalImage.is_current.is_(True))).first()
    stack = db.get(Stack, img.stack_id) if img and img.stack_id else None
    if stack is not None and stack.library_target_id != lt.id:
        stack = None
    sets = list(db.scalars(select(CaptureSet).where(CaptureSet.library_target_id == lt.id)))
    rows = list(db.execute(select(CaptureFrame, CaptureSet.session_id, CaptureSet.device)
                           .join(CaptureSet, CaptureFrame.capture_set_id == CaptureSet.id)
                           .where(CaptureSet.library_target_id == lt.id)))
    frames = [r[0] for r in rows]
    captured = float(sum(f.exptime_s for f in frames)) if frames else None
    per_set: dict[str, list[CaptureFrame]] = {}
    for f in frames:
        per_set.setdefault(f.capture_set_id, []).append(f)
    sessions = {s.id: s for s in db.scalars(select(ObservingSession).where(
        ObservingSession.id.in_({cs.session_id for cs in sets}))) } if sets else {}
    nights = []
    for cs in sets:
        fs = per_set.get(cs.id, [])
        if not fs:
            continue
        s = sessions.get(cs.session_id)
        if s is None:
            continue
        times = sorted(f.date_obs_utc for f in fs)
        nights.append({"session_id": cs.session_id, "night_date": s.local_night_date, "device": cs.device,
                       "frames": len(fs), "captured_s": float(sum(f.exptime_s for f in fs)),
                       "first_utc": times[0], "last_utc": times[-1], "planned": s.source in ("planned", "both")})
    nights.sort(key=lambda n: (n["night_date"], n["device"]), reverse=True)
    all_stacks = list(db.scalars(select(Stack).where(Stack.library_target_id == lt.id)
                                 .order_by(Stack.imported_at.desc(), Stack.id)))
    final = None
    if img:
        final = {"id": img.id, "source_filename": img.source_filename, "format": img.format, "width": img.width,
                 "height": img.height, "stack_id": img.stack_id, "chosen_at": img.chosen_at,
                 "preview_url": f"/api/astrolog/images/{img.id}/preview", "thumb_url": _thumb_url(img)}
    return {
        "target": summary(lt),
        "final_image": final,
        "stack": stack_out(stack) if stack else None,
        "stacks": [stack_out(s) for s in all_stacks],  # listed individually; never combined
        "headline": _headline(captured, stack, all_stacks[0] if all_stacks else None),
        "captured_s": captured,
        "frames_total": len(frames),
        "percent_used": percent_used(stack, [f.date_obs_utc for f in frames]),
        "facts": _facts(frames, [r[2] for r in rows]),
        "nights": nights,
        "stack_suggestion_id": suggest_stack_id(db, lt.id, img.source_filename) if img else None,
    }


def capture_info(db: Session, session_ids: list[str]) -> dict[str, tuple[list[dict[str, Any]], list[str]]]:
    """Plan vs actual for many sessions with a fixed number of queries.

    Per session: its capture sets, and the planned catalog targets not shot. ``not_shot`` is only
    reported once something was imported for the session (a purely planned one is still [])."""
    out: dict[str, tuple[list[dict[str, Any]], list[str]]] = {i: ([], []) for i in session_ids}
    if not session_ids:
        return out
    sets = list(db.scalars(select(CaptureSet).where(CaptureSet.session_id.in_(session_ids))
                           .order_by(CaptureSet.created_at)))
    targets = {lt.id: lt for lt in db.scalars(select(LibraryTarget).where(
        LibraryTarget.id.in_({cs.library_target_id for cs in sets})))} if sets else {}
    agg = {cid: (n, float(secs)) for cid, n, secs in db.execute(
        select(CaptureFrame.capture_set_id, func.count(CaptureFrame.id), func.coalesce(func.sum(CaptureFrame.exptime_s), 0.0))
        .where(CaptureFrame.capture_set_id.in_([cs.id for cs in sets])).group_by(CaptureFrame.capture_set_id))} if sets else {}
    shot: dict[str, set[str]] = {}
    for cs in sets:
        lt = targets.get(cs.library_target_id)
        if lt is None:
            continue
        n, secs = agg.get(cs.id, (0, 0.0))
        if lt.catalog_target_id:
            shot.setdefault(cs.session_id, set()).add(lt.catalog_target_id)
        out[cs.session_id][0].append({
            "library_target_id": lt.id, "display_name": display_name(lt), "device": cs.device, "frames": n,
            "captured_s": secs, "equipment_id": cs.equipment_id, "equipment_snapshot": cs.equipment_snapshot})
    with_sets = {cs.session_id for cs in sets}
    if with_sets:
        for st in db.scalars(select(SessionTarget).where(SessionTarget.session_id.in_(with_sets))
                             .order_by(SessionTarget.sort_order)):
            if st.target_id not in shot.get(st.session_id, set()):
                out[st.session_id][1].append(st.target_id)
    return out


def session_capture_info(db: Session, s: ObservingSession) -> tuple[list[dict[str, Any]], list[str]]:
    return capture_info(db, [s.id])[s.id]
