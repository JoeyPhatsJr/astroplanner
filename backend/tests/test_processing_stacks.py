"""Phase 4 Task 10: stack uploads (measured in memory, never stored) and the advice they drive in steps 6-9."""

from __future__ import annotations

import io
import json

import numpy as np
import pytest
from astropy.io import fits
from PIL import Image
from sqlalchemy import select

from app.processing.models import ProcessingRun
from app.processing.rules import COLOUR_CAST_RATIO, RESIDUAL_FOR_DEGREE2

from .test_astrolog_import import make_location
from .test_processing_runs import RUNS, make_run, only_set_id, seestar_night  # noqa: F401  (api fixture below)
from .test_processing_runs import api  # noqa: F401


def _fits(ramp=0.0, bumps=0.0, bg=(1000.0, 1000.0, 1000.0), size=(96, 128), seed=3, **header) -> bytes:
    rng = np.random.default_rng(seed)
    h, w = size
    yy, xx = np.mgrid[0:h, 0:w]
    out = np.empty((3, h, w), dtype=np.float32)
    for c in range(3):
        shape = ramp * xx / w + bumps * np.sin(xx / w * 6 * np.pi) * np.sin(yy / h * 6 * np.pi)
        out[c] = bg[c] + shape + rng.normal(0.0, 5.0, (h, w))
    out[:, 2, 2] += 8000.0  # something bright so the brightness range is nonzero
    hdu = fits.PrimaryHDU(out)
    hdu.header["SITELAT"] = 39.95
    hdu.header["SITELONG"] = -75.16
    hdu.header["STACKCNT"] = 654
    for k, v in header.items():
        hdu.header[k] = v
    buf = io.BytesIO()
    hdu.writeto(buf)
    return buf.getvalue()


def _post(c, run_id, side, data, name="stack.fit"):
    return c.post(f"{RUNS}/{run_id}/stacks/{side}", files={"file": (name, data, "application/octet-stream")})


@pytest.fixture
def run(api):
    seestar_night(api, make_location(api))
    return make_run(api)


def _step(r, sid):
    return next(s for s in r["steps"] if s["id"] == sid)


def _files(c):
    root = c.app.state.storage.root
    return sorted(p for p in root.rglob("*") if p.is_file())


def test_ramp_stack_gets_measured_degree_one(api, run):
    r = _post(api, run["id"], "siril", _fits(ramp=60.0))
    assert r.status_code == 200, r.text
    a = _step(r.json(), "background")["advice"][0]
    assert a["basis"] == "measured" and a["heuristic"] is True and a["rule_id"] == "background.degree"
    assert "degree 1" in a["setting"] and "subsky 1" in a["setting"]
    assert "of the image's brightness range" in a["why"] and "sky level" not in a["why"]
    m = r.json()["comparison"]["siril_stack"]["measurement"]
    assert f"{100 * m['gradient_frac']:.1f} %" in a["why"]
    assert _step(r.json(), "background")["prompt"] is None


def test_residual_heavy_stack_gets_degree_two(api, run):
    r = _post(api, run["id"], "siril", _fits(bumps=60.0))
    m = r.json()["comparison"]["siril_stack"]["measurement"]
    assert m["gradient_residual_frac"] >= RESIDUAL_FOR_DEGREE2
    a = _step(r.json(), "background")["advice"][0]
    assert a["basis"] == "measured" and "degree 2" in a["setting"] and "subsky 2" in a["setting"]


def test_colour_cast_names_strongest_channel(api, run):
    r = _post(api, run["id"], "siril", _fits(bg=(1000.0, 1200.0, 1000.0)))
    m = r.json()["comparison"]["siril_stack"]["measurement"]
    assert max(m["bg_rgb_ratio"]) > COLOUR_CAST_RATIO
    a = _step(r.json(), "colour")["advice"][0]
    assert a["basis"] == "measured" and "green" in a["setting"]
    assert "plate-solved" in a["why"] and "pcc" in a["why"]


def test_neutral_background_reports_no_cast(api, run):
    a = _step(_post(api, run["id"], "siril", _fits()).json(), "colour")["advice"][0]
    assert a["basis"] == "measured" and "No strong colour cast" in a["setting"]


def test_stretch_is_taste_with_and_without_stack(api, run):
    before = _step(run, "stretch")["advice"][0]
    after = _step(_post(api, run["id"], "siril", _fits()).json(), "stretch")["advice"][0]
    assert before["basis"] == after["basis"] == "taste" and "autostretch" in after["setting"]
    assert "noise" in after["why"] and "noise" not in before["why"]


def test_without_stack_defaults_and_prompt(api, run):
    for sid in ("background", "colour"):
        s = _step(run, sid)
        assert s["advice"][0]["basis"] == "tutorial-default"
        assert s["prompt"] == "Add your Siril stack to get advice for this night"
    s = _step(run, "stretch")
    assert s["advice"][0]["basis"] == "taste" and s["prompt"] == "Add your Siril stack to get advice for this night"
    assert _step(run, "finish")["prompt"] is None


def test_non_fits_is_422(api, run):
    buf = io.BytesIO()
    Image.new("RGB", (100, 100)).save(buf, "JPEG")
    r = _post(api, run["id"], "siril", buf.getvalue(), "stack.jpg")
    assert r.status_code == 422 and r.json()["detail"] == "Stacks must be FITS files"
    assert api.get(f"{RUNS}/{run['id']}").json()["comparison"] == {} and _files(api) == []


def test_unknown_side_and_run(api, run):
    assert _post(api, run["id"], "other", _fits()).status_code == 404
    assert _post(api, "nope", "siril", _fits()).status_code == 404


def test_tiny_stack_is_422(api, run):
    r = _post(api, run["id"], "siril", _fits(size=(5, 5)))
    assert r.status_code == 422 and "at least 64" in r.json()["detail"]
    assert api.get(f"{RUNS}/{run['id']}").json()["comparison"] == {}


def test_non_finite_measurement_is_422(api, run, monkeypatch):
    from app.processing import measure, routes
    real = measure.measure_stack

    def bad(data, name):
        m, p, t = real(data, name)
        from dataclasses import replace
        return replace(m, noise_frac=float("nan")), p, t

    monkeypatch.setattr(routes, "measure_stack", bad)
    r = _post(api, run["id"], "siril", _fits())
    assert r.status_code == 422 and "finite" in r.json()["detail"]
    assert api.get(f"{RUNS}/{run['id']}").json()["comparison"] == {} and _files(api) == []


def test_too_large_is_413(make_client, clear_provider):
    with make_client(clear_provider, max_upload_bytes=1000) as c:
        seestar_night(c, make_location(c))
        run = make_run(c)
        assert _post(c, run["id"], "siril", _fits()).status_code == 413


def test_stored_row_has_numbers_not_pixels_or_coordinates(api, run):
    _post(api, run["id"], "siril", _fits())
    with api.app.state.db.session() as s:
        row = s.scalars(select(ProcessingRun)).one()
        stored = json.dumps(row.comparison)
    entry = row.comparison["siril_stack"]
    assert set(entry) == {"measurement", "preview_key", "thumb_key", "source_filename"}
    assert entry["source_filename"] == "stack.fit" and entry["measurement"]["method"] == "coach-measure-2"
    assert len(stored) < 2000
    for needle in ("SITELAT", "SITELONG", "39.95", "75.16"):
        assert needle not in stored
        assert needle not in json.dumps(api.get(f"{RUNS}/{run['id']}").json())


def test_two_files_per_upload_and_reupload_replaces(api, run):
    first = _post(api, run["id"], "siril", _fits(seed=1)).json()["comparison"]["siril_stack"]
    files = _files(api)
    assert len(files) == 2
    assert {p.name for p in files} == {first["preview_key"].rsplit("/", 1)[1], first["thumb_key"].rsplit("/", 1)[1]}
    second = _post(api, run["id"], "siril", _fits(seed=2), "again.fit").json()["comparison"]["siril_stack"]
    assert len(_files(api)) == 2
    assert second["preview_key"] != first["preview_key"] and second["source_filename"] == "again.fit"
    assert api.get(f"{RUNS}/{run['id']}/images/{first['preview_key']}").status_code == 404
    # a different side adds its own two files
    _post(api, run["id"], "seestar", _fits(seed=4))
    assert len(_files(api)) == 4


def test_images_are_served_as_jpeg(api, run):
    e = _post(api, run["id"], "siril", _fits()).json()["comparison"]["siril_stack"]
    r = api.get(f"{RUNS}/{run['id']}/images/{e['thumb_key']}")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert Image.open(io.BytesIO(r.content)).format == "JPEG"
    assert api.get(f"{RUNS}/{run['id']}/images/processing/other/x.jpg").status_code == 404
    assert api.get(f"{RUNS}/{run['id']}/images/../../x").status_code == 404


def test_seestar_stack_does_not_drive_advice(api, run):
    r = _post(api, run["id"], "seestar", _fits(bg=(1000.0, 1200.0, 1000.0))).json()
    assert _step(r, "colour")["advice"][0]["basis"] == "tutorial-default"
    assert _step(r, "background")["prompt"] is not None
