"""Write a synthetic Seestar S30 night folder for the Processing Coach end-to-end tests.

Usage (from backend/):
    .venv/bin/python scripts/make_synthetic_night.py [OUT_DIR] [--object "NGC 7000"] [--start 2026-10-04T03:00:00]
                                                    [--lat 42.0] [--lon -77.0] [--frames 40]

Default OUT_DIR is ../frontend/e2e/fixtures/synthetic-night (git-ignored; regenerate any time). Everything is made up:
dummy coordinates, header-only FITS lights (a real S30 header, one small empty data block), and Siril-style text
(`process/*.seq`, `process/light_conversion.txt`) built by the same helper the backend tests use. The light
basenames in `lights/` are exactly the ones listed in the conversion file, so importing `lights/` into AstroLog
and then picking the folder in the coach match frame for frame. Of the frames, 6 are "not aligned" and 8 are
"aligned but left out", so the report has something to show. No real data and no absolute paths are written.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from datetime import datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.processing.seq import RegData  # noqa: E402
from tests.astrolog_fixtures import seestar_sub_header  # noqa: E402
from tests.processing_fixtures import synthetic_conversion, synthetic_seq  # noqa: E402

UNALIGNED_EVERY = (5, 6, 7, 18, 30, 31)
DROPPED = (2, 9, 12, 15, 22, 25, 33, 38)


def basename(obj: str, i: int) -> str:
    return f"Light_{obj}_10.0s_LP_{i:04d}.fit"


def build(out: Path, obj: str, start: datetime, lat: float, lon: float, frames: int) -> None:
    if out.exists():
        shutil.rmtree(out)
    (out / "lights").mkdir(parents=True)
    (out / "process").mkdir()
    names = [basename(obj, i) for i in range(1, frames + 1)]
    for i, name in enumerate(names):
        t = (start + timedelta(seconds=15 * i)).strftime("%Y-%m-%dT%H:%M:%S.000000")
        header = seestar_sub_header(object=obj, date_obs=t, SITELAT=lat, SITELONG=lon)
        (out / "lights" / name).write_bytes(header + bytes(2880))  # header + one small data block

    regs: list[RegData | None] = []
    d = k = 0
    for i in range(1, frames + 1):
        if i in UNALIGNED_EVERY:
            regs.append(None)
        elif i in DROPPED:
            regs.append(RegData(2.0 + 0.01 * i, 3.0 + 0.01 * i, round(0.63 + 0.01 * d, 4), 0.0, 0.017, 30 + i % 15))
            d += 1
        else:
            regs.append(RegData(2.0 + 0.01 * i, 3.0 + 0.01 * i, round(0.78 + 0.002 * k, 4), 0.0, 0.017, 30 + i % 15))
            k += 1
    kept = [(i, r) for i, r in enumerate(regs, start=1) if r is not None and i not in DROPPED]
    proc = out / "process"
    (proc / "light_.seq").write_text(synthetic_seq("light_", [(True, None)] * frames, layer=None))
    (proc / "pp_light_.seq").write_text(synthetic_seq("pp_light_", [(r is not None, r) for r in regs]))
    (proc / "r_pp_light_.seq").write_text(
        synthetic_seq("r_pp_light_", [(True, r) for _, r in kept], filenums=[i for i, _ in kept])
    )
    # Relative source folder: the real file holds absolute paths, which the app drops anyway.
    (proc / "light_conversion.txt").write_text(synthetic_conversion(names, src_dir="lights"))


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("out", nargs="?", default=str(BACKEND.parent / "frontend" / "e2e" / "fixtures" / "synthetic-night"))
    p.add_argument("--object", default="NGC 7000")
    p.add_argument("--start", default="2026-10-04T03:00:00", help="UTC DATE-OBS of the first frame")
    p.add_argument("--lat", type=float, default=42.0)
    p.add_argument("--lon", type=float, default=-77.0)
    p.add_argument("--frames", type=int, default=40)
    a = p.parse_args()
    build(Path(a.out), a.object, datetime.fromisoformat(a.start), a.lat, a.lon, a.frames)
    print(f"wrote {a.frames} synthetic frames to {a.out}")


if __name__ == "__main__":
    main()
