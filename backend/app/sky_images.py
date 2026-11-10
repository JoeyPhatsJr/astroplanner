"""Digitized Sky Survey thumbnails for target cards.

Each target is fetched from STScI at most once, reduced to a small greyscale JPEG and cached on disk.
Requests are serialised and spaced out, failures back off, and nothing is fetched when disabled.
A caller that finds another fetch in progress is told so at once (SkyImageBusy) rather than held waiting,
so a cold cache never ties up the browser's few connections to this host.
Images come from the DSS (POSS2/UKSTU red); credit STScI/DSS wherever they are shown.
"""

from __future__ import annotations

import io
import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Callable

import httpx
import numpy as np
from PIL import Image

from .weather import USER_AGENT

log = logging.getLogger(__name__)

DSS_URL = "https://archive.stsci.edu/cgi-bin/dss_search"
DSS_SURVEY = "poss2ukstu_red"
OUT_PX = 480
JPEG_QUALITY = 80
WHITE_MEAN = 250.0        # a row or column this bright is plate edge, not sky
MAX_TRIM_FRACTION = 0.15  # more white than this on one side: the plate does not cover the field
MIN_FIELD_ARCMIN, MAX_FIELD_ARCMIN = 40, 120
SKY_FIELD_OVERRIDES = {"ic1396": 120}
DEFAULT_CACHE_DIR = Path(__file__).resolve().parents[1] / "data" / "sky-images"
LOCK_TIMEOUT_S = 1.0      # how long a caller waits for another fetch before being told the provider is busy
BUSY_RETRY_AFTER_S = 5    # Retry-After sent with a busy 503

_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")


def sky_field_arcmin(target_id: str, major: float | None) -> int:
    """Square field width for a target's image: 1.5x its major axis, clamped to what the service accepts."""
    if target_id in SKY_FIELD_OVERRIDES:
        return SKY_FIELD_OVERRIDES[target_id]
    if major is None:
        return MIN_FIELD_ARCMIN
    return max(MIN_FIELD_ARCMIN, min(MAX_FIELD_ARCMIN, round(1.5 * major)))


def default_fetch(ra_deg: float, dec_deg: float, field_arcmin: int) -> bytes:
    params = {"v": DSS_SURVEY, "r": f"{ra_deg:.6f}", "d": f"{dec_deg:.6f}", "e": "J2000",
              "h": field_arcmin, "w": field_arcmin, "f": "gif"}
    with httpx.Client(timeout=60.0, headers={"User-Agent": USER_AGENT}) as client:
        resp = client.get(DSS_URL, params=params)
        resp.raise_for_status()
        return resp.content


def _trim_white(a: np.ndarray) -> np.ndarray | None:
    """Drop near-white outer rows and columns; None if any side loses more than MAX_TRIM_FRACTION."""
    h, w = a.shape
    rows, cols = a.mean(axis=1), a.mean(axis=0)

    def lead(means: np.ndarray) -> int:
        n = 0
        while n < len(means) and means[n] >= WHITE_MEAN:
            n += 1
        return n

    top, bottom, left, right = lead(rows), lead(rows[::-1]), lead(cols), lead(cols[::-1])
    if top >= h or left >= w:
        return None
    if max(top / h, bottom / h, left / w, right / w) > MAX_TRIM_FRACTION:
        return None
    return a[top:h - bottom, left:w - right]


def _process(body: bytes) -> bytes | None:
    # The service answers errors with HTTP 200 and an HTML page, so the magic number is the real check.
    if not body.startswith(b"GIF8"):
        return None
    with Image.open(io.BytesIO(body)) as im:
        grey = np.asarray(im.convert("L"))
    trimmed = _trim_white(grey)
    if trimmed is None:
        return None
    h, w = trimmed.shape
    s = min(h, w)
    y0, x0 = (h - s) // 2, (w - s) // 2
    img = Image.fromarray(trimmed[y0:y0 + s, x0:x0 + s]).resize((OUT_PX, OUT_PX), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    img.save(out, "JPEG", quality=JPEG_QUALITY)
    return out.getvalue()


class SkyImageBusy(Exception):
    """Another fetch holds the provider; try again shortly."""


class SkyImageProvider:
    def __init__(self, cache_dir: Path, fetch: Callable[[float, float, int], bytes] = default_fetch,
                 enabled: bool = True, min_interval_s: float = 1.0, retry_after_s: float = 3600.0,
                 lock_timeout_s: float = LOCK_TIMEOUT_S,
                 now: Callable[[], float] = time.time, sleep: Callable[[float], None] = time.sleep):
        self.cache_dir = Path(cache_dir)
        self._fetch = fetch
        self.enabled = enabled
        self.min_interval_s = min_interval_s
        self.retry_after_s = retry_after_s
        self.lock_timeout_s = lock_timeout_s
        self._now = now
        self._sleep = sleep
        self._lock = threading.Lock()
        self._failed_at: dict[str, float] = {}
        self._last_request: float | None = None

    @classmethod
    def from_env(cls) -> "SkyImageProvider":
        off = os.environ.get("ASTROPLANNER_SKY_IMAGES", "").strip().lower() == "off"
        return cls(Path(os.environ.get("ASTROPLANNER_SKY_CACHE_DIR") or DEFAULT_CACHE_DIR), enabled=not off)

    def _path(self, target_id: str, field_arcmin: int) -> Path:
        return self.cache_dir / f"{target_id}-{field_arcmin}.jpg"

    def _backing_off(self, target_id: str) -> bool:
        t = self._failed_at.get(target_id)
        return t is not None and self._now() - t < self.retry_after_s

    def get(self, target_id: str, ra_deg: float, dec_deg: float, field_arcmin: int) -> Path | None:
        """The cached image path, or None when unavailable. Raises SkyImageBusy while another fetch runs."""
        if not self.enabled or not _SAFE_ID.match(target_id):
            return None
        path = self._path(target_id, field_arcmin)
        if path.is_file():
            return path
        if self._backing_off(target_id):
            return None
        if not self._lock.acquire(timeout=self.lock_timeout_s):
            raise SkyImageBusy()
        try:
            return self._fetch_locked(target_id, ra_deg, dec_deg, field_arcmin, path)
        finally:
            self._lock.release()

    def _fetch_locked(self, target_id: str, ra_deg: float, dec_deg: float, field_arcmin: int, path: Path) -> Path | None:
        # Re-check under the lock: the caller that held it may have just fetched or failed this target.
        if path.is_file():
            return path
        if self._backing_off(target_id):
            return None
        if self._last_request is not None:
            wait = self.min_interval_s - (self._now() - self._last_request)
            if wait > 0:
                self._sleep(wait)
        self._last_request = self._now()
        try:
            jpeg = _process(self._fetch(ra_deg, dec_deg, field_arcmin))
        except Exception as exc:  # network, decode or decompression-bomb errors all mean "no image"
            log.warning("sky image for %s failed: %s", target_id, type(exc).__name__)
            jpeg = None
        self._last_request = self._now()
        if jpeg is None:
            self._failed_at[target_id] = self._now()
            return None
        self._failed_at.pop(target_id, None)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + f".{os.getpid()}.tmp")
        tmp.write_bytes(jpeg)
        os.replace(tmp, path)
        return path
