"""Phase 4 Task 11: the Seestar picture upload, its "edited" status, and ComparisonOut."""

from __future__ import annotations

import io

import pytest
from PIL import Image

from .test_processing_runs import RUNS, make_run, seestar_night  # noqa: F401
from .test_processing_runs import api  # noqa: F401
from .test_astrolog_import import make_location
from .test_processing_stacks import _fits, _post, _step

SOFTWARE = "Adobe Lightroom 11.5.21 (iOS)"


def _jpeg(software: str | None = None, size=(90, 160), fmt="JPEG") -> bytes:
    im = Image.new("RGB", size, (30, 40, 90))
    buf = io.BytesIO()
    if software is not None:
        exif = Image.Exif()
        exif[305] = software
        im.save(buf, fmt, exif=exif)
    else:
        im.save(buf, fmt)
    return buf.getvalue()


def _picture(c, run_id, data, name="seestar.jpg"):
    return c.post(f"{RUNS}/{run_id}/pictures/seestar", files={"file": (name, data, "application/octet-stream")})


@pytest.fixture
def run(api):
    seestar_night(api, make_location(api))
    return make_run(api)


def test_empty_comparison(api, run):
    c = run["compare"]
    assert c == {"mode_available": {"pictures": False, "stacks": False}, "seestar_picture": None,
                 "final_picture": None, "siril_stack": None, "seestar_stack": None}


def test_compare_step_is_not_blocked_without_stacks(api, run):
    assert _step(run, "compare")["blocked"] is None


def test_software_exif_sets_edited_by_and_edited(api, run):
    r = _picture(api, run["id"], _jpeg(SOFTWARE))
    assert r.status_code == 200, r.text
    p = r.json()["compare"]["seestar_picture"]
    assert p["edited_by"] == SOFTWARE and p["edited"] is True
    assert (p["width"], p["height"], p["source_filename"]) == (90, 160, "seestar.jpg")
    img = api.get(p["preview_url"])
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
    assert not Image.open(io.BytesIO(img.content)).getexif()  # previews carry no metadata


def test_no_exif_is_unknown(api, run):
    p = _picture(api, run["id"], _jpeg()).json()["compare"]["seestar_picture"]
    assert p["edited"] is None and p["edited_by"] is None


def test_user_can_set_and_clear_edited(api, run):
    _picture(api, run["id"], _jpeg())
    url = f"{RUNS}/{run['id']}"
    r = api.patch(url, json={"comparison": {"seestar_picture": {"edited": False}}})
    assert r.status_code == 200 and r.json()["compare"]["seestar_picture"]["edited"] is False
    r = api.patch(url, json={"comparison": {"seestar_picture": {"edited": None}}})
    assert r.json()["compare"]["seestar_picture"]["edited"] is None


@pytest.mark.parametrize("body", [
    {"seestar_picture": {"edited": "yes"}},
    {"seestar_picture": {"edited_by": "x"}},
    {"seestar_picture": {"preview_key": "x"}},
    {"siril_stack": {"edited": True}},
])
def test_patch_whitelists_only_edited_bool_or_null(api, run, body):
    _picture(api, run["id"], _jpeg())
    assert api.patch(f"{RUNS}/{run['id']}", json={"comparison": body}).status_code == 422


def test_patch_without_a_picture_is_409(api, run):
    r = api.patch(f"{RUNS}/{run['id']}", json={"comparison": {"seestar_picture": {"edited": True}}})
    assert r.status_code == 409


def test_png_accepted_fits_and_garbage_rejected(api, run):
    assert _picture(api, run["id"], _jpeg(fmt="PNG"), "a.png").status_code == 200
    assert _picture(api, run["id"], _fits(), "a.fit").status_code == 422
    assert _picture(api, run["id"], b"not an image", "a.jpg").status_code == 422
    assert api.post(f"{RUNS}/nope/pictures/seestar", files={"file": ("a.jpg", _jpeg())}).status_code == 404


def test_reupload_replaces_files_and_resets_edited(api, run):
    first = _picture(api, run["id"], _jpeg(SOFTWARE)).json()["compare"]["seestar_picture"]
    root = api.app.state.storage.root
    assert len([p for p in root.rglob("*") if p.is_file()]) == 2
    second = _picture(api, run["id"], _jpeg()).json()["compare"]["seestar_picture"]
    assert second["edited"] is None and second["preview_url"] != first["preview_url"]
    assert api.get(first["preview_url"]).status_code == 404
    assert len([p for p in root.rglob("*") if p.is_file()]) == 2


def test_stacks_carry_measurement_and_preview_but_no_storage_keys(api, run):
    c = _post(api, run["id"], "siril", _fits()).json()["compare"]
    s = c["siril_stack"]
    assert set(s) == {"preview_url", "measurement", "source_filename"}
    assert s["measurement"]["stack_count"] == 654 and s["measurement"]["method"] == "coach-measure-2"
    assert api.get(s["preview_url"]).status_code == 200
    assert c["seestar_stack"] is None and c["mode_available"] == {"pictures": False, "stacks": False}
    c = _post(api, run["id"], "seestar", _fits(seed=4)).json()["compare"]
    assert c["mode_available"]["stacks"] is True
    assert "preview_key" not in str(c) and "thumb_key" not in str(c)


def test_final_picture_is_the_targets_current_final_image(api, run):
    tid = run["target"]["id"]
    r = api.post(f"/api/astrolog/targets/{tid}/final-image", files={"file": ("final.jpg", _jpeg(), "image/jpeg")})
    assert r.status_code in (200, 201), r.text
    c = api.get(f"{RUNS}/{run['id']}").json()["compare"]
    f = c["final_picture"]
    assert f["source_filename"] == "final.jpg" and f["preview_url"].startswith("/api/astrolog/images/")
    assert (f["width"], f["height"]) == (90, 160)
    assert api.get(f["preview_url"]).status_code == 200
    _picture(api, run["id"], _jpeg())
    assert api.get(f"{RUNS}/{run['id']}").json()["compare"]["mode_available"]["pictures"] is True
