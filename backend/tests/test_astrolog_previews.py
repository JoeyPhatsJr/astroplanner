from __future__ import annotations

import io

import numpy as np
import pytest
import tifffile
from astropy.io import fits
from PIL import Image

from app.astrolog.models import FinalImage, LibraryTarget, Stack
from app.astrolog.previews import ImageTooLarge, UnsupportedImage, make_previews, suggest_stack_id
from app.astrolog.storage import LocalStorage
from app.db import Database


def _tiff16(h=1920, w=1080) -> bytes:
    rng = np.random.default_rng(1)
    arr = (rng.random((h, w, 3)) * 40000).astype(np.uint16)
    buf = io.BytesIO()
    tifffile.imwrite(buf, arr, photometric="rgb")
    return buf.getvalue()


def _fits_rgb() -> bytes:
    rng = np.random.default_rng(2)
    arr = rng.random((3, 400, 300)).astype(np.float32) * 5
    buf = io.BytesIO()
    fits.PrimaryHDU(arr).writeto(buf)
    return buf.getvalue()


def _jpeg_gps() -> bytes:
    img = Image.new("RGB", (300, 200), (90, 20, 20))
    exif = Image.Exif()
    exif[0x010F] = "SecretCam"
    exif.get_ifd(0x8825)[1] = "N"
    exif.get_ifd(0x8825)[2] = (39.0, 57.0, 9.0)
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    return buf.getvalue()


def _dims(b: bytes):
    im = Image.open(io.BytesIO(b))
    return im.format, im.size


def test_tiff16_previews():
    prev, thumb, w, h, _ = make_previews(_tiff16(), "final.tif")
    assert (w, h) == (1080, 1920)
    f, size = _dims(prev)
    assert f == "JPEG" and max(size) <= 1600 and max(size) > 1000
    f, size = _dims(thumb)
    assert f == "JPEG" and max(size) <= 400


def test_fits_float_rgb_preview():
    prev, thumb, w, h, _ = make_previews(_fits_rgb(), "m27.fit")
    assert (w, h) == (300, 400)
    assert _dims(prev)[0] == "JPEG"


def test_mono_tiff_float_and_png_ok():
    buf = io.BytesIO()
    tifffile.imwrite(buf, np.random.rand(50, 60).astype(np.float32))
    assert make_previews(buf.getvalue(), "a.tiff")[2:4] == (60, 50)
    pb = io.BytesIO()
    Image.new("RGB", (40, 30)).save(pb, "PNG")
    assert make_previews(pb.getvalue(), "a.png")[2:] == (40, 30, "png")


def test_exif_gps_stripped():
    src = _jpeg_gps()
    assert b"Exif" in src and b"SecretCam" in src
    prev, thumb, _, _, _ = make_previews(src, "a.jpg")
    for out in (prev, thumb):
        assert b"Exif" not in out and b"GPS" not in out and b"SecretCam" not in out
        assert not Image.open(io.BytesIO(out)).getexif()


def test_unsupported_and_corrupt():
    with pytest.raises(UnsupportedImage):
        make_previews(b"xx", "a.CR2")
    with pytest.raises(UnsupportedImage):
        make_previews(b"not an image", "a.jpg")


def test_fits_orientation_bottom_up():
    arr = np.zeros((3, 40, 60), dtype=np.float32)
    arr[:, :5, :5] = 100.0  # FITS row 0, col 0 = bottom-left of the image
    arr[:, 10:30, 20:40] = 1.0
    buf = io.BytesIO(); fits.PrimaryHDU(arr).writeto(buf)
    prev = Image.open(io.BytesIO(make_previews(buf.getvalue(), "o.fit")[0])).convert("L")
    assert prev.size == (60, 40)
    assert prev.getpixel((2, 37)) > 150      # bottom-left bright
    assert prev.getpixel((2, 2)) < 60        # top-left dark


def test_content_must_match_extension():
    eps = b"%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n"
    with pytest.raises(UnsupportedImage):
        make_previews(eps, "x.jpg")
    pb = io.BytesIO(); Image.new("RGB", (9, 9)).save(pb, "PNG")
    with pytest.raises(UnsupportedImage):
        make_previews(pb.getvalue(), "x.jpg")


def test_decoded_pixel_cap():
    big = io.BytesIO()
    Image.new("L", (4000, 4000)).save(big, "PNG")
    with pytest.raises(ImageTooLarge):
        make_previews(big.getvalue(), "a.png", max_pixels=1_000_000)


def test_local_storage_roundtrip_and_traversal(tmp_path):
    s = LocalStorage(tmp_path / "root")
    s.put("a/b.jpg", b"1", "image/jpeg")
    assert s.get("a/b.jpg") == b"1"
    s.delete("a/b.jpg")
    with pytest.raises(KeyError):
        s.get("a/b.jpg")
    with pytest.raises(ValueError):
        s.put("../evil", b"x", "image/jpeg")


# ---------- HTTP ----------

@pytest.fixture
def cl(make_client, clear_provider, tmp_path):
    with make_client(clear_provider, db_path=tmp_path / "p.db", max_upload_bytes=200_000) as c:
        yield c


@pytest.fixture
def target_id(cl):
    with cl.app.state.db.session() as s:
        lt = LibraryTarget(custom_name="M 27", normalized_key="m27", kind="custom")
        s.add(lt); s.commit()
        return lt.id


def _post(cl, tid, name, data, **form):
    return cl.post(f"/api/astrolog/targets/{tid}/final-image", files={"file": (name, data)}, data=form)


def _jpg(size=(120, 80)):
    b = io.BytesIO(); Image.new("RGB", size, (10, 200, 10)).save(b, "JPEG"); return b.getvalue()


def test_upload_and_fetch(cl, target_id):
    r = _post(cl, target_id, "final.jpg", _jpg())
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["is_current"] is True and j["width"] == 120 and j["height"] == 80
    p = cl.get(f"/api/astrolog/images/{j['id']}/preview")
    assert p.status_code == 200 and p.headers["content-type"] == "image/jpeg"
    t = cl.get(f"/api/astrolog/images/{j['id']}/thumb")
    assert t.status_code == 200 and t.content[:2] == b"\xff\xd8"
    assert cl.get("/api/astrolog/images/nope/preview").status_code == 404


def test_unsupported_415_nothing_stored(cl, target_id, tmp_path):
    for name in ("raw.CR2", "movie.mp4"):
        r = _post(cl, target_id, name, b"data")
        assert r.status_code == 415 and r.json()["detail"]
    r = _post(cl, target_id, "bad.jpg", b"garbage")
    assert r.status_code == 415
    assert not list((tmp_path / "previews").rglob("*.jpg"))
    with cl.app.state.db.session() as s:
        assert s.query(FinalImage).count() == 0


def test_eps_named_jpg_415_nothing_stored(cl, target_id, tmp_path):
    r = _post(cl, target_id, "x.jpg", b"%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n")
    assert r.status_code == 415
    assert not list((tmp_path / "previews").rglob("*.jpg"))
    with cl.app.state.db.session() as s:
        assert s.query(FinalImage).count() == 0


def test_png_format_from_content_and_basename(cl, target_id):
    b = io.BytesIO(); Image.new("RGB", (20, 20)).save(b, "PNG")
    j = _post(cl, target_id, "C:\\secret\\dir/pic.png", b.getvalue()).json()
    assert j["format"] == "PNG".lower() and j["source_filename"] == "pic.png"
    r = cl.get(f"/api/astrolog/images/{j['id']}/thumb")
    assert r.headers["x-content-type-options"] == "nosniff"


def test_read_limited_streamed_counter():
    import asyncio
    from fastapi import HTTPException
    from app.astrolog.routes import _read_limited

    class F:
        def __init__(self): self.n = 0
        async def read(self, size):
            self.n += 1
            return b"x" * size if self.n < 10 else b""

    with pytest.raises(HTTPException) as e:
        asyncio.run(_read_limited(F(), 3 * 1024 * 1024 + 5))
    assert e.value.status_code == 413
    assert len(asyncio.run(_read_limited(F(), 20 * 1024 * 1024))) == 9 * 1024 * 1024


def test_oversize_413_nothing_stored(cl, target_id, tmp_path):
    r = _post(cl, target_id, "big.jpg", b"\xff" * 300_000)
    assert r.status_code == 413 and "MB" in r.json()["detail"]
    assert not list((tmp_path / "previews").rglob("*.jpg"))
    with cl.app.state.db.session() as s:
        assert s.query(FinalImage).count() == 0


def test_unknown_target_404(cl):
    assert _post(cl, "missing", "a.jpg", _jpg()).status_code == 404


def test_second_image_replaces_current(cl, target_id):
    a = _post(cl, target_id, "a.jpg", _jpg()).json()
    b = _post(cl, target_id, "b.jpg", _jpg((60, 60))).json()
    with cl.app.state.db.session() as s:
        cur = {i.id: i.is_current for i in s.query(FinalImage)}
    assert cur == {a["id"]: False, b["id"]: True}


def test_stack_id_form_and_link(cl, target_id):
    with cl.app.state.db.session() as s:
        st = Stack(library_target_id=target_id, source_filename="x.fit", provenance="header", dedup_key="k1")
        s.add(st); s.commit(); sid = st.id
    r = _post(cl, target_id, "a.jpg", _jpg(), stack_id=sid)
    assert r.json()["stack_id"] == sid
    assert _post(cl, target_id, "a.jpg", _jpg(), stack_id="nope").status_code == 422
    b = _post(cl, target_id, "b.jpg", _jpg()).json()
    assert b["stack_id"] is None
    l = cl.post(f"/api/astrolog/targets/{target_id}/stack-link", json={"final_image_id": b["id"], "stack_id": sid})
    assert l.status_code == 200 and l.json()["stack_id"] == sid
    bad = cl.post(f"/api/astrolog/targets/{target_id}/stack-link", json={"final_image_id": b["id"], "stack_id": "zz"})
    assert bad.status_code == 404
    un = cl.post(f"/api/astrolog/targets/{target_id}/stack-link", json={"final_image_id": b["id"], "stack_id": None})
    assert un.json()["stack_id"] is None


# ---------- suggest_stack_id ----------

def test_suggest_stack_id(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 's.db'}"); db.init()
    with db.session() as s:
        lt = LibraryTarget(custom_name="X", normalized_key="x", kind="custom")
        s.add(lt); s.flush()
        other = LibraryTarget(custom_name="Y", normalized_key="y", kind="custom")
        s.add(other); s.flush()
        mk = lambda t, n, c, ts, k: Stack(library_target_id=t, source_filename=n, stack_count=c,
                                          provenance="header", dedup_key=k, imported_at=ts)
        a = mk(lt.id, "Stacked_100x10.0sec_M27.fit", 100, "2026-01-01", "a")
        b = mk(lt.id, "Stacked_654x10.0sec_M27.fit", 654, "2026-01-02", "b")
        c = mk(lt.id, "other.fit", None, "2026-01-03", "c")
        d = mk(other.id, "Stacked_654x10.0sec_Y.fit", 654, "2026-01-09", "d")
        s.add_all([a, b, c, d]); s.commit()
        assert suggest_stack_id(s, lt.id, "M27_100x10.0sec_final.tif") == a.id
        assert suggest_stack_id(s, lt.id, "M27_654x10sec.tif") == b.id
        assert suggest_stack_id(s, lt.id, "M27_999x10sec.tif") == c.id   # no match -> most recent
        assert suggest_stack_id(s, lt.id, "final.tif") == c.id      # most recent
        assert suggest_stack_id(s, other.id, "final.tif") == d.id
        empty = LibraryTarget(custom_name="Z", normalized_key="z", kind="custom")
        s.add(empty); s.commit()
        assert suggest_stack_id(s, empty.id, "final.tif") is None
