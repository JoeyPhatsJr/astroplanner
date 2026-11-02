"""Pure header/filename parsing for Astrolog: FITS headers, Canon CR2 EXIF, Siril filenames."""

from __future__ import annotations

import io
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any, Literal

import exifread
from astropy.io import fits

BLOCK = 2880
MAX_FITS_BLOCKS = 10


class HeaderError(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass
class FitsInfo:
    kind: Literal["sub", "stack", "other"]
    object: str | None
    date_obs_utc: datetime | None
    exptime_s: float | None
    filter: str | None
    gain: float | None
    ccd_temp_c: float | None
    instrument: str | None
    telescop: str | None
    site_lat: float | None
    site_lon: float | None
    stack_count: int | None
    livetime_s: float | None
    expstart_jd: float | None
    expend_jd: float | None
    program: str | None


@dataclass
class ExifInfo:
    model: str | None
    lens: str | None
    exposure_s: float | None
    iso: int | None
    f_number: float | None
    focal_mm: float | None
    captured_local: datetime | None  # naive: camera clock = local time


def _f(v: Any) -> float | None:
    try:
        return None if v is None or isinstance(v, bool) else float(v)
    except (TypeError, ValueError):
        return None


def _s(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _parse_date(v: Any) -> datetime | None:
    s = _s(v)
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def parse_fits_header(data: bytes) -> FitsInfo:
    data = data[: BLOCK * MAX_FITS_BLOCKS]
    if not data.startswith(b"SIMPLE"):
        raise HeaderError("not a FITS file (no SIMPLE card)")
    end = None
    for off in range(0, len(data) - 79, 80):
        if data[off : off + 80].rstrip() == b"END":
            end = off + 80
            break
    if end is None:
        raise HeaderError("FITS header truncated (no END card)")
    try:
        h = fits.Header.fromstring(data[:end].decode("ascii", errors="replace"), sep="")
    except Exception as exc:  # astropy raises assorted errors on malformed cards
        raise HeaderError(f"unreadable FITS header: {exc}") from exc

    program = _s(h.get("PROGRAM"))
    stack_count = h.get("STACKCNT")
    imagetyp = (_s(h.get("IMAGETYP")) or "").lower()
    if stack_count is not None or (program or "").lower().startswith("siril"):
        kind: Literal["sub", "stack", "other"] = "stack"
    elif imagetyp == "light":
        kind = "sub"
    else:
        kind = "other"
    exptime = h.get("EXPTIME", h.get("EXPOSURE"))
    sc = _f(stack_count)
    return FitsInfo(
        kind=kind,
        object=_s(h.get("OBJECT")),
        date_obs_utc=_parse_date(h.get("DATE-OBS")),
        exptime_s=_f(exptime),
        filter=_s(h.get("FILTER")),
        gain=_f(h.get("GAIN")),
        ccd_temp_c=_f(h.get("CCD-TEMP")),
        instrument=_s(h.get("INSTRUME")),
        telescop=_s(h.get("TELESCOP")),
        site_lat=_f(h.get("SITELAT")),
        site_lon=_f(h.get("SITELONG")),
        stack_count=int(sc) if sc is not None else None,
        livetime_s=_f(h.get("LIVETIME")),
        expstart_jd=_f(h.get("EXPSTART")),
        expend_jd=_f(h.get("EXPEND")),
        program=program,
    )


def _ratio(tag: Any) -> float | None:
    if tag is None or not getattr(tag, "values", None):
        return None
    v = tag.values[0]
    try:
        return float(v.num) / float(v.den) if v.den else None
    except AttributeError:
        return _f(v)


def _text(tags: dict, key: str) -> str | None:
    t = tags.get(key)
    return _s(t.printable) if t is not None else None


def parse_cr2_exif(data: bytes) -> ExifInfo:
    try:
        tags = exifread.process_file(io.BytesIO(data), details=False)
    except Exception as exc:
        raise HeaderError(f"unreadable EXIF: {exc}") from exc
    if not tags:
        raise HeaderError("no EXIF data found")
    iso_tag = tags.get("EXIF ISOSpeedRatings")
    iso = None
    if iso_tag is not None and getattr(iso_tag, "values", None):
        iso = int(iso_tag.values[0])
    captured = None
    raw = _text(tags, "EXIF DateTimeOriginal") or _text(tags, "Image DateTime")
    if raw:
        try:
            captured = datetime.strptime(raw, "%Y:%m:%d %H:%M:%S")
        except ValueError:
            captured = None
    return ExifInfo(
        model=_text(tags, "Image Model"),
        lens=_text(tags, "EXIF LensModel"),
        exposure_s=_ratio(tags.get("EXIF ExposureTime")),
        iso=iso,
        f_number=_ratio(tags.get("EXIF FNumber")),
        focal_mm=_ratio(tags.get("EXIF FocalLength")),
        captured_local=captured,
    )


_STACK_RE = re.compile(r"(\d+)x(\d+(?:\.\d+)?)sec")


def parse_stack_filename(name: str) -> tuple[int, float] | None:
    m = _STACK_RE.search(name)
    return (int(m.group(1)), float(m.group(2))) if m else None


def normalize_object(name: str) -> str:
    return re.sub(r"[\s_]+", "", name.strip()).lower()


_IGNORED_EXT = {".seq", ".lst", ".txt", ".dylib", ".onnx", ".mp4"}
_IGNORED_PREFIX = ("pp_", "r_", ".")


def is_ignored(relative_path: str) -> bool:
    p = PurePosixPath(relative_path.replace("\\", "/"))
    if any(part.lower() == "process" for part in p.parts[:-1]) or p.name.lower() == "process":
        return True
    name = p.name
    if name.startswith(_IGNORED_PREFIX):
        return True
    return p.suffix.lower() in _IGNORED_EXT
