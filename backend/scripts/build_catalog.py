"""Build backend/app/data/targets.json from OpenNGC source files.

Usage:
    python scripts/build_catalog.py <path/to/NGC.csv> <path/to/addendum.csv> [commit_sha]

Coordinates, types, angular sizes and magnitudes come verbatim from OpenNGC
(https://github.com/mattiaverga/OpenNGC, CC-BY-SA-4.0). The only curated fields
added here are: which objects are included, the display name, the broad
category used for filtering, and the ``emission_line_dominant`` flag (a curator
annotation used only by the Moon-tolerance heuristic; it is NOT an OpenNGC
field). Because the output is a derivative of OpenNGC, it is distributed under
CC-BY-SA-4.0 as well (see app/data/ATTRIBUTION.md).
"""

from __future__ import annotations

import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# (OpenNGC name, display name, category, emission_line_dominant)
CURATED: list[tuple[str, str, str, bool]] = [
    # Galaxies
    ("NGC0224", "Andromeda Galaxy", "galaxy", False),
    ("NGC0598", "Triangulum Galaxy", "galaxy", False),
    ("NGC5194", "Whirlpool Galaxy", "galaxy", False),
    ("NGC3031", "Bode's Galaxy", "galaxy", False),
    ("NGC3034", "Cigar Galaxy", "galaxy", False),
    ("NGC5457", "Pinwheel Galaxy", "galaxy", False),
    ("NGC4594", "Sombrero Galaxy", "galaxy", False),
    ("NGC0253", "Sculptor Galaxy", "galaxy", False),
    ("NGC4565", "Needle Galaxy", "galaxy", False),
    ("NGC0891", "NGC 891", "galaxy", False),
    ("NGC3627", "M66 (Leo Triplet)", "galaxy", False),
    ("NGC3623", "M65 (Leo Triplet)", "galaxy", False),
    ("NGC4826", "Black Eye Galaxy", "galaxy", False),
    ("NGC5055", "Sunflower Galaxy", "galaxy", False),
    ("NGC4258", "M106", "galaxy", False),
    ("NGC0628", "Phantom Galaxy", "galaxy", False),
    ("NGC5128", "Centaurus A", "galaxy", False),
    ("NGC2403", "NGC 2403", "galaxy", False),
    ("NGC7331", "NGC 7331", "galaxy", False),
    # Nebulae
    ("NGC1976", "Orion Nebula", "nebula", True),
    ("NGC6523", "Lagoon Nebula", "nebula", True),
    ("NGC6611", "Eagle Nebula", "nebula", True),
    ("NGC6618", "Omega (Swan) Nebula", "nebula", True),
    ("NGC6514", "Trifid Nebula", "nebula", True),
    ("NGC1952", "Crab Nebula", "nebula", True),
    ("NGC6853", "Dumbbell Nebula", "nebula", True),
    ("NGC6720", "Ring Nebula", "nebula", True),
    ("NGC7000", "North America Nebula", "nebula", True),
    ("IC5070", "Pelican Nebula", "nebula", True),
    ("NGC6960", "Western Veil Nebula", "nebula", True),
    ("NGC6992", "Eastern Veil Nebula", "nebula", True),
    ("NGC2238", "Rosette Nebula", "nebula", True),
    ("IC0434", "IC 434 (Horsehead region)", "nebula", True),
    ("NGC7293", "Helix Nebula", "nebula", True),
    ("NGC1499", "California Nebula", "nebula", True),
    ("IC1805", "Heart Nebula", "nebula", True),
    ("IC1396", "IC 1396 (Elephant's Trunk region)", "nebula", True),
    ("NGC7635", "Bubble Nebula", "nebula", True),
    ("NGC3372", "Carina Nebula", "nebula", True),
    ("NGC2068", "M78", "nebula", False),  # reflection nebula -> broadband
    ("NGC3587", "Owl Nebula", "nebula", True),
    ("NGC0650", "Little Dumbbell Nebula", "nebula", True),
    ("NGC2392", "Eskimo Nebula", "nebula", True),
    ("NGC0281", "Pacman Nebula", "nebula", True),
    ("NGC6888", "Crescent Nebula", "nebula", True),
    # Clusters
    ("Mel022", "Pleiades", "cluster", False),
    ("NGC6205", "Hercules Globular Cluster", "cluster", False),
    ("NGC5272", "M3", "cluster", False),
    ("NGC5904", "M5", "cluster", False),
    ("NGC6341", "M92", "cluster", False),
    ("NGC6656", "M22", "cluster", False),
    ("NGC0869", "h Persei (Double Cluster)", "cluster", False),
    ("NGC0884", "chi Persei (Double Cluster)", "cluster", False),
    ("NGC2632", "Beehive Cluster", "cluster", False),
    ("NGC2168", "M35", "cluster", False),
    ("NGC7789", "Caroline's Rose", "cluster", False),
    ("NGC5139", "Omega Centauri", "cluster", False),
    ("NGC0104", "47 Tucanae", "cluster", False),
]

TYPE_LABELS = {
    "G": "Galaxy",
    "GCl": "Globular cluster",
    "OCl": "Open cluster",
    "PN": "Planetary nebula",
    "SNR": "Supernova remnant",
    "HII": "HII region",
    "RfN": "Reflection nebula",
    "Neb": "Nebula",
    "Cl+N": "Star cluster + nebula",
    "EmN": "Emission nebula",
}


def hms_to_deg(value: str) -> float:
    h, m, s = value.split(":")
    return round((float(h) + float(m) / 60 + float(s) / 3600) * 15.0, 6)


def dms_to_deg(value: str) -> float:
    sign = -1.0 if value.strip().startswith("-") else 1.0
    d, m, s = value.strip().lstrip("+-").split(":")
    return round(sign * (float(d) + float(m) / 60 + float(s) / 3600), 6)


def opt_float(value: str) -> float | None:
    value = (value or "").strip()
    return float(value) if value else None


def designation(name: str) -> str:
    """NGC0224 -> NGC 224, IC0434 -> IC 434, Mel022 -> Mel 22."""
    for prefix in ("NGC", "IC", "Mel"):
        if name.startswith(prefix):
            return f"{prefix} {int(name[len(prefix):])}"
    return name


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    rows: dict[str, dict[str, str]] = {}
    for path in sys.argv[1:3]:
        with open(path, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh, delimiter=";"):
                rows[row["Name"]] = row
    commit = sys.argv[3] if len(sys.argv) > 3 else "master"

    targets = []
    for name, display, category, emission in CURATED:
        row = rows.get(name)
        if row is None:
            sys.exit(f"{name} missing from OpenNGC input")
        if row["Type"] == "Dup":
            sys.exit(f"{name} is an OpenNGC duplicate entry; choose the primary object")
        messier = row["M"].strip()
        primary = f"M {int(messier)}" if messier else designation(name)
        aliases = [designation(name)] if messier else []
        aliases += [a.strip() for a in row["Common names"].split(",") if a.strip()]
        aliases += [a.strip() for a in row["Identifiers"].split(",") if a.strip()][:4]
        vmag = opt_float(row["V-Mag"])
        bmag = opt_float(row["B-Mag"])
        target_id = (f"m{int(messier)}" if messier else designation(name).lower().replace(" ", ""))
        targets.append(
            {
                "id": target_id,
                "primary_designation": primary,
                "name": display,
                "aliases": list(dict.fromkeys(a for a in aliases if a != primary)),
                "category": category,
                "kind": TYPE_LABELS.get(row["Type"], row["Type"]),
                "openngc_type": row["Type"],
                "constellation": row["Const"],
                "ra_deg": hms_to_deg(row["RA"]),
                "dec_deg": dms_to_deg(row["Dec"]),
                "coordinate_frame": "ICRS",
                "epoch": "J2000",
                "magnitude": vmag if vmag is not None else bmag,
                "magnitude_band": "V" if vmag is not None else ("B" if bmag is not None else None),
                "angular_major_arcmin": opt_float(row["MajAx"]),
                "angular_minor_arcmin": opt_float(row["MinAx"]),
                "emission_line_dominant": emission,
                "source": "OpenNGC",
                "source_id": name,
                "source_url": f"https://github.com/mattiaverga/OpenNGC/blob/{commit}/database_files/"
                + ("addendum.csv" if name.startswith("Mel") else "NGC.csv"),
            }
        )

    ids = [t["id"] for t in targets]
    assert len(ids) == len(set(ids)), "duplicate target ids"
    out = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "OpenNGC",
        "source_repository": "https://github.com/mattiaverga/OpenNGC",
        "source_commit": commit,
        "license": "CC-BY-SA-4.0",
        "notes": (
            "Positions are OpenNGC J2000 catalog positions. For very large nebulae the catalog "
            "position may not be the visual centre. emission_line_dominant is a curator "
            "annotation used only for the Moon-tolerance heuristic."
        ),
        "targets": targets,
    }
    dest = Path(__file__).resolve().parent.parent / "app" / "data" / "targets.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(targets)} targets to {dest}")


if __name__ == "__main__":
    main()
