"""Phase 4 Task 5: the night report on the developer's real Siril folder (local only, read-only).

Skipped unless ASTROPLANNER_REAL_NIGHT_DIR points at the night folder (the one holding `lights/` and `process/`).
Reads only the text of `process/*.seq` and `process/*_conversion.txt`, and the FITS headers of `lights/*.fit`
for DATE-OBS (astropy reads the header only). Nothing is written there; no path or coordinate is printed or
stored. There is no AstroLog database of that night here, so the frame times are built from the headers and
`build_folder` / `night_report` are called directly (controller ruling).
"""

from __future__ import annotations

import os
import warnings
from pathlib import Path

import pytest
from astropy.io import fits

from app import astronomy, targets
from app.processing.report import UploadedText, build_folder, night_report

ROOT_ENV = os.environ.get("ASTROPLANNER_REAL_NIGHT_DIR")
pytestmark = pytest.mark.skipif(not ROOT_ENV, reason="ASTROPLANNER_REAL_NIGHT_DIR not set")


def _frame_times(lights: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for p in sorted(lights.glob("*.fit")):
            date_obs = fits.getheader(p).get("DATE-OBS")  # header only; opened read-only
            if date_obs:
                out[p.name] = f"{date_obs}Z" if not date_obs.endswith("Z") else date_obs
    return out


@pytest.fixture(scope="module")
def real_report():
    root = Path(ROOT_ENV)
    proc = root / "process"
    files = [UploadedText(f"process/{p.name}", p.read_text())
             for p in sorted(proc.iterdir()) if p.suffix == ".seq" or p.name.endswith("_conversion.txt")]
    folder = build_folder(files, [], _frame_times(root / "lights"))
    return folder, night_report(folder, 10.0, "America/New_York")


def test_real_night_totals(real_report):
    folder, rep = real_report
    assert folder.registration_seq == "pp_light_" and folder.kept_seq == "r_pp_light_"
    assert folder.kept_error is None and folder.matched == 1015
    assert (rep.totals["captured"], rep.totals["aligned"], rep.totals["kept"]) == (1015, 851, 654)
    assert rep.totals["kept_s"] == 6540.0
    assert rep.time_unknown == 0


def test_real_night_medians(real_report):
    _, rep = real_report
    assert rep.medians["stars"] == 44
    assert round(rep.medians["fwhm"], 2) == 2.25
    assert rep.ranges["stars"] == [13, 64]


def test_real_night_round_cut(real_report):
    _, rep = real_report
    rc = next(f for f in rep.findings if f.id == "round_cut")
    # Highest dropped 0.742286, lowest kept 0.744081: the 2 dp midpoint 0.74 would not lie above every dropped
    # frame, so the rule keeps one more decimal (see the task report). It still rounds to the brief's 0.74.
    assert rc.value == 0.743 and round(rc.value, 2) == 0.74
    assert rc.title == "The 197 aligned frames left out of the stack all had roundness below 0.743"


def test_real_night_time_split(real_report):
    _, rep = real_report
    ts = next(f for f in rep.findings if f.id == "time_split")
    assert ts.title.startswith("Before 03:30, 51 % of frames reached the stack; from 03:30 on, 91 %"), ts.title
    assert "Possible causes" not in ts.detail  # no altitude function: no cause offered


def test_real_night_no_invented_cause():
    """With the app's own altitude (site from the first header, used in-process only) the Bubble Nebula stayed
    high all night, so the split finding names no cause."""
    root = Path(ROOT_ENV)
    first = sorted((root / "lights").glob("*.fit"))[0]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        h = fits.getheader(first)
    lat, lon = float(h["SITELAT"]), float(h["SITELONG"])
    t = targets.lookup("ngc7635")
    ra, dec = t["ra_deg"], t["dec_deg"]
    proc = root / "process"
    files = [UploadedText(f"process/{p.name}", p.read_text())
             for p in sorted(proc.iterdir()) if p.suffix == ".seq" or p.name.endswith("_conversion.txt")]
    folder = build_folder(files, [], _frame_times(root / "lights"))
    rep = night_report(folder, 10.0, "America/New_York",
                       altitude=lambda utcs: astronomy.altitude_deg(ra, dec, lat, lon, utcs))
    ts = next(f for f in rep.findings if f.id == "time_split")
    assert "Possible causes" not in ts.detail
