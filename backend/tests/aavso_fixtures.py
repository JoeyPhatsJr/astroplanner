"""Synthetic AAVSO VSX ``api.delim`` responses, built ONLY for tests (never real observations).

The header is the exact column list observed from VSX on 2026-11-02 (spec §2). Every row plants
canary values in the private columns (observer name, country, comment, chart IDs) and a fake
observer code, so tests can assert none of them ever comes out of the app.
"""

from __future__ import annotations

import csv
import io

import httpx

VSX_HEADER = (
    "JD,mag,uncert,band,by,comCode,compStar1,compStar2,charts,comment,transformed,airmass,val,cmag,kmag,"
    "starName,obsAffil,mtype,adsRef,digitizer,credit,obsID,fainterThan,obsType,software,obsName,obsCountry"
).split(",")

SENTINEL_NAME = "ZZ_SENTINEL_NAME"
SENTINEL_COUNTRY = "ZZ_SENTINEL_COUNTRY"
SENTINEL_CODE = "ZZSEN"
SENTINEL_COMMENT = "ZZ_SENTINEL_COMMENT, with a comma"
SENTINEL_CHARTS = "ZZ_SENTINEL_CHART"
# Every string a privacy test must never find in an Observation, DB row, response or log line.
SENTINELS = ("ZZ_SENTINEL", "ZZSEN", "ZZOB")

_DEFAULTS = {
    "uncert": "", "band": "Vis.", "by": SENTINEL_CODE, "comCode": "", "compStar1": "110", "compStar2": "114",
    "charts": SENTINEL_CHARTS, "comment": SENTINEL_COMMENT, "transformed": "0", "airmass": "", "val": "Z",
    "cmag": "", "kmag": "", "starName": "SS CYG", "obsAffil": "", "mtype": "STD", "adsRef": "", "digitizer": "",
    "credit": "", "fainterThan": "0", "obsType": "Visual", "software": "", "obsName": SENTINEL_NAME,
    "obsCountry": SENTINEL_COUNTRY,
}


def make_csv(rows: list[dict]) -> str:
    """CSV text with the real VSX header; unspecified columns get the defaults (incl. sentinels)."""
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=VSX_HEADER, lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow({**_DEFAULTS, **{k: ("" if v is None else str(v)) for k, v in r.items()}})
    return buf.getvalue()


def row(jd: float, mag, *, obs_id: str | None = None, by: str = SENTINEL_CODE, band: str = "Vis.",
        fainter: bool = False, **extra) -> dict:
    """One observation row; the default obsID is derived from the JD (unique to 1e-5 d)."""
    return {"JD": f"{jd:.5f}", "mag": mag, "by": by, "band": band, "fainterThan": "1" if fainter else "0",
            "obsID": str(int(round(jd * 100000))) if obs_id is None else obs_id, **extra}


def observers(n: int) -> list[str]:
    """Distinct fake observer codes ZZOB1..ZZOBn."""
    return [f"ZZOB{i + 1}" for i in range(n)]


def quiet_curve(start_jd: float, days: int, per_day: int = 4, mag: float = 12.0, n_observers: int = 3) -> list[dict]:
    """A flat quiescent curve: ``per_day`` visual estimates a day from rotating observers."""
    codes = observers(n_observers)
    return [row(start_jd + d + (i + 0.5) / per_day, f"{mag + 0.1 * ((d + i) % 3 - 1):.1f}", by=codes[(d + i) % n_observers])
            for d in range(days) for i in range(per_day)]


def outburst_curve(start_jd: float, days: int, peak_day: int, peak_mag: float = 8.6, quiet: float = 12.0,
                   per_day: int = 4, n_observers: int = 3) -> list[dict]:
    """Quiet, then a fast rise to ``peak_mag`` on ``peak_day`` and a slower linear fade."""
    codes = observers(n_observers)
    out = []
    for d in range(days):
        if d < peak_day - 1:
            m = quiet
        elif d <= peak_day:
            m = peak_mag + (quiet - peak_mag) * (peak_day - d) / 2
        else:
            m = min(quiet, peak_mag + 0.35 * (d - peak_day))
        out += [row(start_jd + d + (i + 0.5) / per_day, f"{m:.1f}", by=codes[(d + i) % n_observers]) for i in range(per_day)]
    return out


class VsxResponder:
    """Serves ``rows`` like VSX would: only those with fromjd <= JD <= tojd."""

    def __init__(self, rows: list[dict]):
        self.rows = rows

    def __call__(self, params: dict) -> httpx.Response:
        lo, hi = float(params["fromjd"]), float(params["tojd"])
        return httpx.Response(200, text=make_csv([r for r in self.rows if lo <= float(r["JD"]) <= hi]))


class RecordingFetch:
    """Records every params dict (and the timeout asked for); raises ``fail_with`` on the calls listed in
    ``fail_on`` (1-based)."""

    def __init__(self, responder, fail_on: set[int] | None = None, fail_with: Exception | None = None):
        self.responder = responder
        self.calls: list[dict] = []
        self.timeouts: list[float | None] = []
        self.fail_on = fail_on or set()
        self.fail_with = fail_with or httpx.ConnectError("offline")

    def __call__(self, params: dict, timeout_s: float | None = None) -> httpx.Response:
        self.calls.append(params)
        self.timeouts.append(timeout_s)
        if len(self.calls) in self.fail_on:
            raise self.fail_with
        return self.responder(params)

    def ranges(self) -> list[tuple[float, float]]:
        return [(float(c["fromjd"]), float(c["tojd"])) for c in self.calls]


class FakeClock:
    """A monotonic clock plus a sleep that records each wait and advances the clock."""

    def __init__(self, t: float = 1000.0):
        self.t = t
        self.sleeps: list[float] = []

    def clock(self) -> float:
        return self.t

    def sleep(self, s: float) -> None:
        self.sleeps.append(s)
        self.t += s
