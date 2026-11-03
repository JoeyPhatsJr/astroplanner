"""Build backend/app/data/variables.json from the AAVSO VSX object API.

Usage:
    python scripts/build_variables.py

Makes one request per curated star to
``https://vsx.aavso.org/index.php?view=api.object&ident=<name>&format=json``
(sequential, at least 2 s apart, identifying user agent, vsx.aavso.org only).
Catalog facts (coordinates, type, range, period, epoch, OID) come verbatim from
VSX; the alert thresholds, missions, labels and history windows are AstroPlanner
curation. Catalog data: International Variable Star Index (VSX), operated at
AAVSO, Cambridge, Massachusetts, USA. See app/data/ATTRIBUTION.md.
"""

from __future__ import annotations

import json
import re
import sys
import time
from datetime import date
from pathlib import Path
from typing import Any

import httpx

VSX_URL = "https://vsx.aavso.org/index.php"
USER_AGENT = "AstroPlanner/0.3 (+https://github.com/JoeyPhatsJr/astroplanner; personal non-commercial)"
MIN_INTERVAL_S = 2.0
OUT = Path(__file__).resolve().parent.parent / "app" / "data" / "variables.json"

ORBITAL_NOTE = (
    "The VSX period is the binary orbital period, not an outburst or eruption interval; "
    "outbursts and eruptions are not periodic enough to predict."
)

# Curated (AstroPlanner-authored) block per star; VSX supplies the rest.
CURATED: list[dict[str, Any]] = [
    {
        "slug": "ss-cyg", "name": "SS Cygni", "primary_designation": "SS Cyg",
        "aliases": ["SS Cyg", "SS Cygni"],
        "type_label": "Dwarf nova (U Gem type)",
        "alert": {
            "brighter_than": 10.0, "min_observers": 2, "normal_text": "quiet near 12 V",
            "why": "Outbursts reach about 8.5 V; 10.0 is well clear of quiescent scatter.",
        },
        "missions": ["outburst", "weekly"], "history_windows": [], "period_note": ORBITAL_NOTE,
    },
    {
        "slug": "u-gem", "name": "U Geminorum", "primary_designation": "U Gem",
        "aliases": ["U Gem", "U Geminorum"],
        "type_label": "Dwarf nova (U Gem type)",
        "alert": {
            "brighter_than": 11.0, "min_observers": 2, "normal_text": "quiet near 14 V",
            "why": "VSX lists a maximum near 8.2 V; 11.0 is well clear of quiescent scatter.",
        },
        "missions": ["outburst", "weekly"], "history_windows": [], "period_note": ORBITAL_NOTE,
    },
    {
        "slug": "r-leo", "name": "R Leonis", "primary_designation": "R Leo",
        "aliases": ["R Leo", "R Leonis"],
        "type_label": "Mira variable",
        "alert": None,
        "missions": ["cycle", "weekly"], "history_windows": [],
    },
    {
        "slug": "t-crb", "name": "T Coronae Borealis", "primary_designation": "T CrB",
        "aliases": ["T CrB", "T Coronae Borealis", "Blaze Star"],
        "type_label": "Recurrent nova",
        "alert": {
            "brighter_than": 8.0, "min_observers": 3, "normal_text": "quiet near 10 V",
            "why": "VSX lists a maximum of 2.0 V; 8.0 is far above quiescent scatter, and 3 independent observers are required.",
        },
        "missions": ["weekly"],
        "history_windows": [{
            "key": "1946", "label": "1946 eruption",
            "from_date": "1946-01-01", "to_date": "1946-06-30",
            "source": "Eruption discovered 1946 February 9; ADS 1946PASP...58..196H",
        }],
        "period_note": ORBITAL_NOTE,
    },
]


def _float(v: Any) -> float | None:
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def parse_mag(raw: str | None) -> tuple[float | None, str | None]:
    """'7.7 V' -> (7.7, 'V'); '(12.4 V' / '12.4: V' tolerated; unparsable -> (None, None)."""
    if not raw:
        return None, None
    m = re.match(r"^\(?\s*(-?\d+(?:\.\d+)?):?\s*([A-Za-z][\w-]*)?", raw.strip())
    if not m:
        return None, None
    return float(m.group(1)), m.group(2)


def vsx_fields(obj: dict[str, Any]) -> dict[str, Any]:
    max_mag, band = parse_mag(obj.get("MaxMag"))
    min_mag, band2 = parse_mag(obj.get("MinMag"))
    return {
        "name": obj["Name"],
        "auid": obj.get("AUID"),
        "oid": int(obj["OID"]),
        "variability_type": obj.get("VariabilityType"),
        "period_days": _float(obj.get("Period")),
        "max_mag": max_mag,
        "min_mag": min_mag,
        "band": band or band2,
        "raw_range": [obj.get("MaxMag"), obj.get("MinMag")],
        "epoch_jd": _float(obj.get("Epoch")),
        "spectral_type": obj.get("SpectralType") or None,
    }


def build_record(cur: dict[str, Any], obj: dict[str, Any], today: str) -> dict[str, Any]:
    v = vsx_fields(obj)
    rec = {
        "id": f"var:{cur['slug']}",
        **cur,
        "constellation": obj.get("Constellation"),
        "ra_deg": float(obj["RA2000"]),
        "dec_deg": float(obj["Declination2000"]),
        "vsx": v,
        "source": "AAVSO VSX",
        "source_url": f"https://vsx.aavso.org/index.php?view=detail.top&oid={v['oid']}",
        "retrieved": today,
    }
    return rec


def fetch(client: httpx.Client, ident: str) -> dict[str, Any]:
    r = client.get(VSX_URL, params={"view": "api.object", "ident": ident, "format": "json"})
    r.raise_for_status()
    return r.json()["VSXObject"]


def main() -> int:
    today = date.today().isoformat()
    records = []
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=30.0) as client:
        for i, cur in enumerate(CURATED):
            if i:
                time.sleep(MIN_INTERVAL_S)
            obj = fetch(client, cur["primary_designation"])
            records.append(build_record(cur, obj, today))
            print(f"fetched {obj['Name']} oid={obj['OID']} type={obj.get('VariabilityType')}")
    records.sort(key=lambda r: r["id"])
    out = {
        "meta": {
            "source": "AAVSO VSX api.object",
            "retrieved": today,
            "license_note": (
                "Permission is granted to display, copy, distribute and download the materials on "
                "this Site for personal, non-commercial use only, provided you do not modify the "
                "materials and that you retain all copyright and other proprietary notices "
                "contained in the materials. (VSX copyright page)"
            ),
        },
        "stars": records,
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(records)} stars to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
