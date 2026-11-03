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
from app.db import ObservingLocation, ObservingSession, SessionTarget

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
    """Linked stack; else (only when the target has no frames) its latest stack; else captured.

    ``basis`` says which stack: "linked" (the current final picture's stack, "in the final stack")
    or "latest" (a stack-only target without a linked picture, "in the latest stack"); None for
    captured time."""
    for st, basis in ((linked, "linked"), (latest if captured_s is None else None, "latest")):
        if st is not None:
            secs, prov = stack_seconds(st)
            if secs is not None:
                return {"seconds": secs, "label": "stack", "provenance": prov, "basis": basis}
    return {"seconds": captured_s, "label": "captured", "provenance": "frames", "basis": None}


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
                      # stack-only target: how many nights went into it is unknown, never 0
                      "captured_s": cs, "nights": c["nights"] if c else None},
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
            out[lt.catalog_target_id] = {"seconds": h["seconds"], "label": h["label"],
                                            "library_target_id": lt.id}
    return out


def _jd(iso_utc: list[str]) -> np.ndarray:
    ts = np.array([datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp()
                   for s in iso_utc])
    return ts / 86400.0 + UNIX_JD_EPOCH


def percent_used(stack: Stack | None, frame_times: list[str]) -> tuple[float | None, int | None]:
    """(percent used, n) where n = captured frames whose DATE-OBS (JD) lies inside the stack's
    EXPSTART-EXPEND. Both None unless n > 0 and the stack's count fits in n (a stack can't use
    more frames than were captured in its range; if it claims to, the frames aren't all here)."""
    if stack is None or not stack.stack_count or stack.expstart_jd is None or stack.expend_jd is None:
        return None, None
    if not frame_times:
        return None, None
    jd = _jd(frame_times)
    n = int(np.count_nonzero((jd >= stack.expstart_jd) & (jd <= stack.expend_jd)))
    if n == 0 or stack.stack_count > n:
        return None, None
    return round(100.0 * stack.stack_count / n, 2), n


def is_canon_frame(f: CaptureFrame) -> bool:
    return f.dedup_key.startswith("cr2:")  # set by the importer from the file kind


def _distinct(vals: list[Any]) -> list[Any]:
    return sorted({v for v in vals if v is not None})


def _fmt(vals: list[Any], unit: str = "", prefix: str = "") -> str | None:
    if not vals:
        return None
    return ", ".join(f"{prefix}{v:g}{unit}" if isinstance(v, float) else f"{prefix}{v}{unit}" for v in vals)


def _span(vals: list[Any]) -> str | None:
    if not vals:
        return None
    return f"{vals[0]:g}" if len(vals) == 1 else f"{vals[0]:g} to {vals[-1]:g}"


def _facts(rows: list[tuple[CaptureFrame, str, str | None]]) -> list[dict[str, Any]]:
    """Header facts with the key each came from: (frame, device, capture set lens) per frame.

    FITS and Canon frames are reported separately because their values come from different keys."""
    fits = [(f, d) for f, d, _ in rows if not is_canon_frame(f)]
    canon = [(f, d, lens) for f, d, lens in rows if is_canon_frame(f)]
    facts: list[tuple[str, str | None, str]] = []
    if fits:
        ff = [f for f, _ in fits]
        facts += [("Camera", _fmt(_distinct([d for _, d in fits])), "INSTRUME"),
                  ("Exposure", _fmt(_distinct([float(f.exptime_s) for f in ff]), " s"), "EXPTIME"),
                  ("Filter", _fmt(_distinct([f.filter for f in ff])), "FILTER"),
                  ("Gain", _fmt(_distinct([f.gain for f in ff])), "GAIN"),
                  ("Sensor temperature (C)", _span(_distinct([f.ccd_temp_c for f in ff])), "CCD-TEMP")]
    if canon:
        cf = [f for f, _, _ in canon]
        facts += [("Camera", _fmt(_distinct([d for _, d, _ in canon])), "EXIF Model"),
                  ("Lens", _fmt(_distinct([lens for _, _, lens in canon])), "EXIF LensModel"),
                  ("Exposure", _fmt(_distinct([float(f.exptime_s) for f in cf]), " s"), "EXIF ExposureTime"),
                  ("ISO", _span(_distinct([f.iso for f in cf])), "EXIF ISOSpeedRatings"),
                  ("f-number", _fmt(_distinct([f.f_number for f in cf]), prefix="f/"), "EXIF FNumber"),
                  ("Focal length", _fmt(_distinct([f.focal_mm for f in cf]), " mm"), "EXIF FocalLength")]
    return [{"label": a, "value": v, "source_key": k} for a, v, k in facts if v is not None]


def _utc_key(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def target_page(db: Session, lt: LibraryTarget) -> dict[str, Any]:
    from .previews import suggest_stack_id

    img = db.scalars(select(FinalImage).where(FinalImage.library_target_id == lt.id,
                                              FinalImage.is_current.is_(True))).first()
    stack = db.get(Stack, img.stack_id) if img and img.stack_id else None
    if stack is not None and stack.library_target_id != lt.id:
        stack = None
    sets = list(db.scalars(select(CaptureSet).where(CaptureSet.library_target_id == lt.id)))
    rows = list(db.execute(select(CaptureFrame, CaptureSet.session_id, CaptureSet.device, CaptureSet.lens)
                           .join(CaptureSet, CaptureFrame.capture_set_id == CaptureSet.id)
                           .where(CaptureSet.library_target_id == lt.id)))
    frames = [r[0] for r in rows]
    captured = float(sum(f.exptime_s for f in frames)) if frames else None
    per_set: dict[str, list[CaptureFrame]] = {}
    for f in frames:
        per_set.setdefault(f.capture_set_id, []).append(f)
    sessions = {s.id: s for s in db.scalars(select(ObservingSession).where(
        ObservingSession.id.in_({cs.session_id for cs in sets}))) } if sets else {}
    loc_ids = {s.location_id for s in sessions.values() if s.location_id}
    tzs = {l.id: l.timezone for l in db.scalars(select(ObservingLocation).where(
        ObservingLocation.id.in_(loc_ids)))} if loc_ids else {}
    nights = []
    for cs in sets:
        fs = per_set.get(cs.id, [])
        if not fs:
            continue
        s = sessions.get(cs.session_id)
        if s is None:
            continue
        times = sorted((f.date_obs_utc for f in fs), key=_utc_key)
        nights.append({"session_id": cs.session_id, "night_date": s.local_night_date, "device": cs.device,
                       "frames": len(fs), "captured_s": float(sum(f.exptime_s for f in fs)),
                       "first_utc": times[0], "last_utc": times[-1],
                       "exptimes_s": _distinct([float(f.exptime_s) for f in fs]),
                       "timezone": tzs.get(s.location_id) if s.location_id else None,
                       "planned": s.source in ("planned", "both")})
    nights.sort(key=lambda n: (n["night_date"], n["device"]), reverse=True)
    all_stacks = list(db.scalars(select(Stack).where(Stack.library_target_id == lt.id)
                                 .order_by(Stack.imported_at.desc(), Stack.id)))
    final = None
    if img:
        final = {"id": img.id, "source_filename": img.source_filename, "format": img.format, "width": img.width,
                 "height": img.height, "stack_id": img.stack_id, "chosen_at": img.chosen_at,
                 "preview_url": f"/api/astrolog/images/{img.id}/preview", "thumb_url": _thumb_url(img)}
    pct, in_range = percent_used(stack, [f.date_obs_utc for f in frames])
    return {
        "target": summary(lt),
        "final_image": final,
        "stack": stack_out(stack) if stack else None,
        "stacks": [stack_out(s) for s in all_stacks],  # listed individually; never combined
        "headline": _headline(captured, stack, all_stacks[0] if all_stacks else None),
        "captured_s": captured,
        "frames_total": len(frames),
        "percent_used": pct,
        "frames_in_stack_range": in_range,  # the denominator of percent_used (never frames_total)
        "facts": _facts([(r[0], r[2], r[3]) for r in rows]),
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
    set_ids = [cs.id for cs in sets]
    # first/last via SQL MIN/MAX on the stored ISO strings: one set is one device whose frames all
    # share one format, and frames are seconds apart, so string order is time order here.
    agg = {cid: (n, float(secs), first, last) for cid, n, secs, first, last in db.execute(
        select(CaptureFrame.capture_set_id, func.count(CaptureFrame.id), func.coalesce(func.sum(CaptureFrame.exptime_s), 0.0),
               func.min(CaptureFrame.date_obs_utc), func.max(CaptureFrame.date_obs_utc))
        .where(CaptureFrame.capture_set_id.in_(set_ids)).group_by(CaptureFrame.capture_set_id))} if sets else {}
    exps: dict[str, list[float]] = {}
    if sets:
        for cid, e in db.execute(select(CaptureFrame.capture_set_id, CaptureFrame.exptime_s).distinct()
                                 .where(CaptureFrame.capture_set_id.in_(set_ids))):
            exps.setdefault(cid, []).append(float(e))
    shot: dict[str, set[str]] = {}
    for cs in sets:
        lt = targets.get(cs.library_target_id)
        if lt is None:
            continue
        n, secs, first, last = agg.get(cs.id, (0, 0.0, None, None))
        if lt.catalog_target_id:
            shot.setdefault(cs.session_id, set()).add(lt.catalog_target_id)
        out[cs.session_id][0].append({
            "library_target_id": lt.id, "display_name": display_name(lt), "device": cs.device, "frames": n,
            "captured_s": secs, "first_utc": first, "last_utc": last, "exptimes_s": sorted(exps.get(cs.id, [])),
            "equipment_id": cs.equipment_id, "equipment_snapshot": cs.equipment_snapshot})
    with_sets = {cs.session_id for cs in sets}
    if with_sets:
        for st in db.scalars(select(SessionTarget).where(SessionTarget.session_id.in_(with_sets))
                             .order_by(SessionTarget.sort_order)):
            if st.target_id not in shot.get(st.session_id, set()):
                out[st.session_id][1].append(st.target_id)
    return out


def session_capture_info(db: Session, s: ObservingSession) -> tuple[list[dict[str, Any]], list[str]]:
    return capture_info(db, [s.id])[s.id]


# ---- moving a custom target to Unsorted ------------------------------------------------------

UNSORTED_KEY = "unsorted"


def is_canonical_unsorted(lt: LibraryTarget) -> bool:
    return lt.normalized_key == UNSORTED_KEY


def canonical_unsorted(db: Session) -> LibraryTarget:
    lt = db.scalars(select(LibraryTarget).where(LibraryTarget.normalized_key == UNSORTED_KEY)).first()
    if lt is None:
        lt = LibraryTarget(normalized_key=UNSORTED_KEY, kind="unsorted")
        db.add(lt)
        db.flush()
    return lt


def merge_into_unsorted(db: Session, lt: LibraryTarget) -> LibraryTarget:
    """Move everything of ``lt`` onto the one canonical Unsorted target, then delete ``lt``.

    Capture sets keep the unique (session, target, device): when Unsorted already has a set for
    that night and device, the frames join it. Stacks and final pictures move with the target; if
    Unsorted already has a current picture it stays current (the moved one is kept as history).
    Nothing is summed or recomputed here: totals are always derived from the frames."""
    from sqlalchemy import update

    dest = canonical_unsorted(db)
    for cs in list(db.scalars(select(CaptureSet).where(CaptureSet.library_target_id == lt.id))):
        existing = db.scalars(select(CaptureSet).where(
            CaptureSet.session_id == cs.session_id, CaptureSet.library_target_id == dest.id,
            CaptureSet.device == cs.device)).first()
        if existing is None:
            cs.library_target_id = dest.id
        else:
            db.execute(update(CaptureFrame).where(CaptureFrame.capture_set_id == cs.id)
                       .values(capture_set_id=existing.id))
            existing.lens = existing.lens or cs.lens
            db.delete(cs)
        db.flush()
    for st in db.scalars(select(Stack).where(Stack.library_target_id == lt.id)):
        st.library_target_id = dest.id
    dest_has_current = db.scalars(select(FinalImage).where(
        FinalImage.library_target_id == dest.id, FinalImage.is_current.is_(True))).first() is not None
    for img in db.scalars(select(FinalImage).where(FinalImage.library_target_id == lt.id)):
        img.library_target_id = dest.id
        if dest_has_current:
            img.is_current = False
    for st in db.scalars(select(SessionTarget).where(SessionTarget.library_target_id == lt.id)):
        st.library_target_id = dest.id
    db.flush()
    db.delete(lt)
    db.flush()
    return dest
