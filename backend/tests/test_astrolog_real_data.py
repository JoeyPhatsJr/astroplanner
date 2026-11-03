"""Task 7: local-only acceptance against the developer's real files (read-only).

Skipped unless ASTROPLANNER_REAL_DATA points at the folder. Only header slices are read (FITS: blocks
until END, max 10 x 2880 bytes; CR2: first 131072 bytes), files are opened "rb" and never modified.
Site coordinates are used in-process to create the saved location and are never printed, logged,
stored in assertion messages or written anywhere.
"""

from __future__ import annotations

import base64
import os
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import func, select

from app.astrolog.headers import is_ignored, parse_cr2_exif, parse_fits_header
from app.astrolog.models import CaptureFrame, Stack

ROOT_ENV = os.environ.get("ASTROPLANNER_REAL_DATA")
pytestmark = pytest.mark.skipif(not ROOT_ENV, reason="ASTROPLANNER_REAL_DATA not set")

NY = ZoneInfo("America/New_York")
COMMIT = "/api/astrolog/import/commit"
PREVIEW = "/api/astrolog/import/preview"
CHUNK = 250  # the API accepts at most 300 items per request
CR2_BYTES = 131072
FITS_BLOCK, FITS_MAX = 2880, 10


def _root() -> Path:
    return Path(ROOT_ENV)


def read_fits_slice(path: Path) -> bytes:
    out = b""
    with open(path, "rb") as f:
        for _ in range(FITS_MAX):
            block = f.read(FITS_BLOCK)
            if not block:
                break
            out += block
            if any(block[i:i + 80].rstrip() == b"END" for i in range(0, len(block), 80)):
                break
    return out


def read_cr2_slice(path: Path) -> bytes:
    with open(path, "rb") as f:
        return f.read(CR2_BYTES)


def items_for(files: list[Path], kind: str) -> list[dict]:
    root = _root()
    reader = read_fits_slice if kind == "fits" else read_cr2_slice
    out = []
    for p in files:
        rel = p.relative_to(root).as_posix()
        assert not is_ignored(rel)
        data = reader(p)
        out.append({"path": rel, "kind": kind, "header_b64": base64.b64encode(data).decode("ascii"),
                    "size": p.stat().st_size})
    return out


def fits_files(sub: str) -> list[Path]:
    return sorted(p for p in (_root() / sub).glob("*.fit") if not is_ignored(p.relative_to(_root()).as_posix()))


@pytest.fixture(scope="module")
def bubble_items():
    files = fits_files("Bubble Nebula/lights")
    assert len(files) == 1015
    return items_for(files, "fits")


@pytest.fixture(scope="module")
def m27_items():
    return items_for(fits_files("Dumbell Nebula/lights"), "fits")


@pytest.fixture(scope="module")
def stack_items():
    files = [p for p in fits_files("Bubble Nebula") if "654x" in p.name]
    assert len(files) == 1
    return items_for(files, "fits")


@pytest.fixture
def api(make_client, clear_provider):
    with make_client(clear_provider) as c:
        yield c


def site_location(api, item: dict) -> str:
    """Create the saved location from the header coordinates, in process only."""
    info = parse_fits_header(base64.b64decode(item["header_b64"]))
    has_coords = (info.site_lat is not None) and (info.site_lon is not None)
    assert has_coords, "header lacks site coordinates"
    r = api.post("/api/locations", json={"label": "Home", "latitude_deg": info.site_lat,
                                         "longitude_deg": info.site_lon, "timezone": "America/New_York"})
    assert r.status_code == 201
    return r.json()["id"]


def commit_all(api, items: list[dict], location_id: str) -> dict:
    total = {"inserted_frames": 0, "inserted_stacks": 0, "skipped": 0}
    for i in range(0, len(items), CHUNK):
        r = api.post(COMMIT, json={"items": items[i:i + CHUNK], "location_id": location_id})
        assert r.status_code == 200, f"commit failed with status {r.status_code}"
        body = r.json()
        total["inserted_frames"] += body["inserted_frames"]
        total["inserted_stacks"] += body["inserted_stacks"]
        total["skipped"] += len(body["skipped"])
    return total


def library_entry(api, catalog_id: str) -> dict:
    lib = api.get("/api/astrolog/library").json()
    hits = [e for e in lib if e["catalog_target_id"] == catalog_id]
    assert len(hits) == 1, "expected exactly one library entry for the target"
    return hits[0]


def target_page(api, catalog_id: str) -> dict:
    entry = library_entry(api, catalog_id)
    tid = entry["id"]
    r = api.get(f"/api/astrolog/targets/{tid}")
    assert r.status_code == 200
    return r.json()


def test_ac1_bubble_lights(api, bubble_items):
    loc = site_location(api, bubble_items[0])
    # Preview (first chunk) matches the saved location from headers alone: no location needed.
    pv = api.post(PREVIEW, json={"items": bubble_items[:CHUNK]}).json()
    assert pv["needs_location"] is False and pv["location_id"] == loc

    first = commit_all(api, bubble_items, loc)
    assert first == {"inserted_frames": 1015, "inserted_stacks": 0, "skipped": 0}

    page = target_page(api, "ngc7635")
    assert page["frames_total"] == 1015
    assert page["captured_s"] == 10150.0
    assert page["headline"]["label"] == "captured" and page["headline"]["seconds"] == 10150.0
    assert len(page["nights"]) == 1
    night = page["nights"][0]
    assert night["night_date"] == "2026-09-11"
    assert night["frames"] == 1015 and night["captured_s"] == 10150.0

    first_local = datetime.fromisoformat(night["first_utc"].replace("Z", "+00:00")).astimezone(NY)
    last_local = datetime.fromisoformat(night["last_utc"].replace("Z", "+00:00")).astimezone(NY)
    # Local time of DATE-OBS (the importer's rule). The brief's 23:11:47 / 05:44:16 are the FILENAME
    # stamps, which trail DATE-OBS by the save overhead (see test_filename_time_relationship).
    assert first_local.strftime("%H:%M:%S") == "23:11:24"
    assert last_local.strftime("%H:%M:%S") == "05:43:55"

    assert night["timezone"] == "America/New_York" and night["exptimes_s"] == [10.0]
    sess = api.get(f"/api/sessions/{night['session_id']}").json()
    start_local = datetime.fromisoformat(sess["start_utc"].replace("Z", "+00:00")).astimezone(NY)
    end_local = datetime.fromisoformat(sess["end_utc"].replace("Z", "+00:00")).astimezone(NY)
    assert start_local.strftime("%H:%M:%S") == "23:11:24" and end_local.strftime("%H:%M:%S") == "05:43:55"

    with api.app.state.db.session() as s:
        rows = list(s.scalars(select(CaptureFrame)))
    assert {r.exptime_s for r in rows} == {10.0}
    assert {r.filter for r in rows} == {"LP"}
    assert {r.gain for r in rows} == {200.0}

    # Re-importing the same files must add nothing.
    second = commit_all(api, bubble_items, loc)
    assert second["inserted_frames"] == 0
    with api.app.state.db.session() as s:
        assert s.scalar(select(func.count()).select_from(CaptureFrame)) == 1015


def test_filename_time_relationship(bubble_items):
    """The filename stamp is the LOCAL (America/New_York) clock at file save, after DATE-OBS (UTC start).

    Measured over all 1015 frames: the stamp trails DATE-OBS by 19.9 s to 37.3 s, i.e. the 10 s exposure
    plus readout/save overhead. Asserted tolerance: 10 s (at least one exposure) to 40 s.
    """
    lo, hi = float("inf"), float("-inf")
    for it in bubble_items:
        info = parse_fits_header(base64.b64decode(it["header_b64"]))
        m = re.search(r"(\d{8}-\d{6})\.fit$", it["path"])
        assert m
        stamp = datetime.strptime(m.group(1), "%Y%m%d-%H%M%S").replace(tzinfo=NY)
        d = (stamp - info.date_obs_utc).total_seconds()
        lo, hi = min(lo, d), max(hi, d)
    assert 10.0 <= lo and hi <= 40.0, "filename stamp is not within 10-40 s after DATE-OBS"


def test_ac2_stack_provenance(api, stack_items, bubble_items):
    loc = site_location(api, bubble_items[0])
    r = api.post(COMMIT, json={"items": stack_items, "location_id": loc})
    assert r.status_code == 200 and r.json()["inserted_stacks"] == 1
    with api.app.state.db.session() as s:
        st = s.scalars(select(Stack)).one()
    assert st.stack_count == 654 and st.livetime_s == 6540.0
    assert st.provenance == "header"
    again = api.post(COMMIT, json={"items": stack_items, "location_id": loc}).json()
    assert again["inserted_stacks"] == 0


def test_ac2_headline_and_percent_used(api, stack_items, bubble_items):
    """Lights + the 654x10sec stack linked to a final picture: 1 h 49 m in the final stack.

    "% used" follows spec 7a: stack count / captured frames whose DATE-OBS lies inside the stack's
    EXPSTART-EXPEND. Measured on the real files: the last 3 of the 1015 lights start after EXPEND
    (164 s after it at most), so the denominator is 1012 and the figure is 64.6% ("65%"), not the
    654/1015 = 64.4% quoted in acceptance criterion 2."""
    import io

    from PIL import Image

    loc = site_location(api, bubble_items[0])
    commit_all(api, bubble_items + stack_items, loc)
    tid = library_entry(api, "ngc7635")["id"]
    with api.app.state.db.session() as s:
        sid = s.scalars(select(Stack)).one().id
    buf = io.BytesIO()
    Image.new("RGB", (40, 30)).save(buf, "JPEG")  # stand-in picture: the real one is not needed here
    r = api.post(f"/api/astrolog/targets/{tid}/final-image", files={"file": ("final.jpg", buf.getvalue())},
                 data={"stack_id": sid})
    assert r.status_code == 200
    page = api.get(f"/api/astrolog/targets/{tid}").json()
    assert page["headline"] == {"seconds": 6540.0, "label": "stack", "provenance": "header", "basis": "linked"}
    assert page["captured_s"] == 10150.0
    assert page["frames_total"] == 1015
    assert page["frames_in_stack_range"] == 1012 and round(page["percent_used"], 1) == 64.6


def test_ac4_dumbbell_is_catalog_m27(api, m27_items, bubble_items):
    loc = site_location(api, bubble_items[0])
    res = commit_all(api, m27_items, loc)
    assert res["inserted_frames"] == 344 and res["skipped"] == 0
    page = target_page(api, "m27")
    assert page["frames_total"] == 344
    assert page["target"]["catalog_target_id"] == "m27"


def test_ac5_canon_night_folder(api, bubble_items):
    folder = _root() / "Dates" / "Aug 12 2026" / "Night" / "lights"
    files = sorted(p for p in folder.glob("*.CR2"))[:CHUNK]
    assert files, "no Canon files found"
    items = items_for(files, "cr2")
    exif = parse_cr2_exif(base64.b64decode(items[0]["header_b64"]))
    model_ok = exif.model == "Canon EOS REBEL T3"
    lens_ok = bool(exif.lens) and "18-55" in exif.lens
    assert model_ok and lens_ok

    loc = site_location(api, bubble_items[0])  # Canon EXIF has no GPS: the user chooses the location
    pv = api.post(PREVIEW, json={"items": items, "location_id": loc})
    assert pv.status_code == 200
    groups = pv.json()["groups"]
    has_groups = len(groups) > 0
    devices_ok = all(g["device"] == "Canon EOS REBEL T3" for g in groups)
    n_skipped = len(pv.json()["skipped"])
    assert has_groups and devices_ok and n_skipped == 0
    r = api.post(COMMIT, json={"items": items, "location_id": loc})
    inserted = r.json()["inserted_frames"] if r.status_code == 200 else -1
    assert inserted == len(items)

    # The stored EXIF (ISO, lens, f-number, focal length) reaches the target page with its EXIF keys.
    with api.app.state.db.session() as s:
        stored_iso = sorted({f.iso for f in s.scalars(select(CaptureFrame))})
    iso_stored = exif.iso is not None and exif.iso in stored_iso and None not in stored_iso
    lib = api.get("/api/astrolog/library").json()
    unsorted_ids = [e["id"] for e in lib if e["kind"] == "unsorted"]
    one_unsorted = len(unsorted_ids) == 1
    assert iso_stored and one_unsorted, "Canon ISO not stored, or not exactly one Unsorted group"
    facts = {f["source_key"]: f for f in api.get(f"/api/astrolog/targets/{unsorted_ids[0]}").json()["facts"]}
    lens_shown = "EXIF LensModel" in facts and "18-55" in facts["EXIF LensModel"]["value"]
    iso_shown = "EXIF ISOSpeedRatings" in facts and str(exif.iso) in facts["EXIF ISOSpeedRatings"]["value"]
    camera_key_ok = facts.get("EXIF Model", {}).get("value") == "Canon EOS REBEL T3" and "INSTRUME" not in facts
    exif_keys_ok = {"EXIF FNumber", "EXIF FocalLength", "EXIF ExposureTime"} <= set(facts)
    assert lens_shown and iso_shown and camera_key_ok and exif_keys_ok, "Canon EXIF facts missing on the target page"
