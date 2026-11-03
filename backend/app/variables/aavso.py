"""AAVSO observation providers: the VSX ``api.delim`` endpoint, or synthetic fixture files.

Only ``https://vsx.aavso.org/index.php`` is ever requested (``www.aavso.org`` sits behind a
Cloudflare challenge that the app must not try to get past). Requests are sequential and at least
``MIN_SPACING_S`` apart across the whole process, with an honest user agent.

Privacy: the CSV carries the observer's name, country, comments and chart IDs. Parsing keeps only
``obsID, JD, mag, uncert, band, fainterThan, obsType, val, by`` and turns ``by`` (the observer
code) into a salted hash at once; nothing else from a row is kept, stored or logged.
"""

from __future__ import annotations

import csv
import hashlib
import io
import math
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol

import httpx

from app.variables import catalog

VSX_URL = "https://vsx.aavso.org/index.php"
USER_AGENT = "AstroPlanner/0.3 (+https://github.com/JoeyPhatsJr/astroplanner; personal non-commercial)"
MIN_SPACING_S = 2.0
TIMEOUT_S = 60.0  # recon: 150 days of SS Cyg took 19 s; a 30-day chunk is far smaller
KEPT_COLUMNS = ("obsID", "JD", "mag", "uncert", "band", "fainterThan", "obsType", "val", "by")
_REQUIRED_COLUMNS = {"obsID", "JD", "mag"}


class AavsoError(Exception):
    """AAVSO could not supply observations. The message is ours (safe to store and show)."""


@dataclass(frozen=True)
class Observation:
    obs_id: str
    jd: float
    mag: float
    uncert: float | None
    band: str
    fainter_than: bool
    obs_type: str
    val: str
    observer_hash: str


class AavsoProvider(Protocol):
    def fetch_observations(self, ident: str, from_jd: float, to_jd: float) -> list[Observation]: ...


def observer_hash(salt: str, code: str) -> str:
    return hashlib.sha256((salt + code).encode("utf-8")).hexdigest()[:16]


def _finite(value: str | None) -> float | None:
    try:
        x = float((value or "").strip())
    except ValueError:
        return None
    return x if math.isfinite(x) else None


def parse_vsx_csv(text: str, salt: str) -> list[Observation]:
    """Observations from a VSX ``api.delim`` CSV body; rows without a numeric JD/mag or an obsID are skipped."""
    if not text.strip():
        return []
    reader = csv.DictReader(io.StringIO(text))
    header = {(h or "").strip() for h in (reader.fieldnames or [])}
    if not _REQUIRED_COLUMNS <= header:
        raise AavsoError("Unexpected response from VSX (not the observation CSV)")
    out: list[Observation] = []
    for raw in reader:
        kept = {k.strip(): (v or "").strip() for k, v in raw.items() if k and k.strip() in KEPT_COLUMNS
                and isinstance(v, str)}
        jd, mag, obs_id = _finite(kept.get("JD")), _finite(kept.get("mag")), kept.get("obsID", "")
        if jd is None or mag is None or not obs_id or len(obs_id) > 40:
            continue
        out.append(Observation(
            obs_id=obs_id,
            jd=jd,
            mag=mag,
            uncert=_finite(kept.get("uncert")),
            band=kept.get("band", "")[:16],
            fainter_than=kept.get("fainterThan") == "1",
            obs_type=kept.get("obsType", "")[:16],
            val=kept.get("val", "")[:4],
            observer_hash=observer_hash(salt, kept.get("by", "")),
        ))
    return out


# Process-wide request spacing (both fetch paths, every provider instance).
_REQUEST_LOCK = threading.Lock()
_last_request_end: float | None = None


def reset_request_spacing() -> None:
    """Forget the last request time (tests use fake clocks)."""
    global _last_request_end
    with _REQUEST_LOCK:
        _last_request_end = None


Fetcher = Callable[[dict], httpx.Response]


def http_fetcher(transport: httpx.BaseTransport | None = None) -> Fetcher:
    """GET ``VSX_URL`` with the app's user agent; redirects are not followed (never to www.aavso.org)."""
    def fetch(params: dict) -> httpx.Response:
        with httpx.Client(timeout=TIMEOUT_S, headers={"User-Agent": USER_AGENT}, transport=transport,
                          follow_redirects=False) as client:
            return client.get(VSX_URL, params=params)
    return fetch


class VsxProvider:
    def __init__(self, fetch: Fetcher | None = None, sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.monotonic, *, salt: str):
        self._fetch = fetch or http_fetcher()
        self._sleep = sleep
        self._clock = clock
        self.salt = salt

    def fetch_observations(self, ident: str, from_jd: float, to_jd: float) -> list[Observation]:
        params = {"view": "api.delim", "ident": ident, "fromjd": f"{from_jd:.5f}", "tojd": f"{to_jd:.5f}",
                  "delimiter": ","}
        global _last_request_end
        with _REQUEST_LOCK:
            if _last_request_end is not None:
                wait = MIN_SPACING_S - (self._clock() - _last_request_end)
                if wait > 0:
                    self._sleep(wait)
            try:
                resp = self._fetch(params)
            except httpx.HTTPError as exc:
                raise AavsoError(f"Could not reach VSX ({type(exc).__name__})") from None
            finally:
                _last_request_end = self._clock()
        if resp.status_code != 200:
            raise AavsoError(f"VSX returned HTTP {resp.status_code}")
        body = resp.text
        if body.lstrip()[:1] == "<":
            raise AavsoError("VSX returned an HTML page, not observation CSV (possibly a browser challenge)")
        return parse_vsx_csv(body, self.salt)


class FixtureProvider:
    """Synthetic observations from ``<dir>/<slug>.csv`` (same CSV format), for e2e and local demos."""

    def __init__(self, dir: Path, salt: str):
        self.dir = Path(dir)
        self.salt = salt

    def fetch_observations(self, ident: str, from_jd: float, to_jd: float) -> list[Observation]:
        slug = next((s["slug"] for s in catalog.all_stars() if s["primary_designation"] == ident),
                    ident.lower().replace(" ", "-"))
        path = self.dir / f"{slug}.csv"
        if not path.is_file():
            raise AavsoError(f"No fixture file for {ident}")
        return [o for o in parse_vsx_csv(path.read_text(encoding="utf-8"), self.salt) if from_jd <= o.jd <= to_jd]
