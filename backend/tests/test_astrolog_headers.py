import io
from datetime import datetime, timezone

import pytest
from PIL import Image
from PIL.TiffImagePlugin import IFDRational

from app.astrolog.headers import (
    HeaderError,
    is_ignored,
    normalize_object,
    parse_cr2_exif,
    parse_fits_header,
    parse_stack_filename,
)

from .astrolog_fixtures import seestar_sub_header, siril_stack_header


def test_sub_header():
    info = parse_fits_header(seestar_sub_header())
    assert info.kind == "sub"
    assert info.object == "NGC 7635"
    assert info.exptime_s == 10.0
    assert info.filter == "LP"
    assert info.gain == 200
    assert info.date_obs_utc == datetime(2026, 9, 12, 3, 11, 24, 634198, tzinfo=timezone.utc)
    assert info.instrument == "Seestar S30"


def test_stack_header():
    info = parse_fits_header(siril_stack_header())
    assert info.kind == "stack"
    assert info.stack_count == 654
    assert info.livetime_s == 6540.0
    assert info.program == "Siril 1.4.4"
    assert info.expstart_jd == pytest.approx(2461295.63, abs=1e-6)


def test_not_fits_raises():
    with pytest.raises(HeaderError):
        parse_fits_header(b"not a fits" * 400)


def test_truncated_raises():
    data = seestar_sub_header()
    with pytest.raises(HeaderError) as e:
        parse_fits_header(data[:800])
    assert e.value.reason


def test_stack_filename():
    assert parse_stack_filename("NGC_7635_654x10sec_T32degC_2026-09-11.fit") == (654, 10.0)
    assert parse_stack_filename("IMG_5578.CR2") is None


@pytest.mark.parametrize(
    "raw,key", [("M 27", "m27"), ("M27", "m27"), ("m 27", "m27"), ("NGC 7635", "ngc7635")]
)
def test_normalize_object(raw, key):
    assert normalize_object(raw) == key


def test_is_ignored():
    assert is_ignored("Bubble Nebula/process/pp_light_00001.fit")
    assert not is_ignored("Bubble Nebula/lights/Light_NGC 7635_10.0s_LP_20260911-231147.fit")
    assert is_ignored("a/pp_x.fit") and is_ignored("a/r_x.fit") and is_ignored("a/.DS_Store")
    assert is_ignored("a/b.seq") and is_ignored("a/b.MP4") and is_ignored("a/b.onnx")


def test_cr2_exif():
    exif = Image.Exif()
    exif[0x0110] = "Canon EOS REBEL T3"
    sub = exif.get_ifd(0x8769)
    sub[0x829A] = IFDRational(20, 1)  # real Canon files store RATIONAL
    sub[0x8827] = 640
    sub[0x829D] = IFDRational(7, 2)
    sub[0x920A] = IFDRational(18, 1)
    sub[0x9003] = "2026:08:12 22:19:50"
    sub[0xA434] = "EF-S18-55mm f/3.5-5.6 IS II"
    exif[0x8769] = sub  # re-attach so Pillow serializes the EXIF sub-IFD
    buf = io.BytesIO()
    Image.new("RGB", (8, 8)).save(buf, format="TIFF", exif=exif)
    info = parse_cr2_exif(buf.getvalue())
    assert info.model == "Canon EOS REBEL T3"
    assert info.lens == "EF-S18-55mm f/3.5-5.6 IS II"
    assert info.exposure_s == 20.0
    assert info.iso == 640
    assert info.f_number == 3.5
    assert info.focal_mm == 18.0
    assert info.captured_local == datetime(2026, 8, 12, 22, 19, 50)
    assert info.captured_local.tzinfo is None


def test_cr2_garbage_raises():
    with pytest.raises(HeaderError):
        parse_cr2_exif(b"\x00" * 500)


def test_siril_program_without_stackcnt_is_sub():
    info = parse_fits_header(seestar_sub_header(PROGRAM="Siril 1.4.4", IMAGETYP="Light"))
    assert info.kind == "sub"
    assert info.stack_count is None


def test_site_and_misc_fields():
    info = parse_fits_header(seestar_sub_header())
    assert info.site_lat == 40.0
    assert info.site_lon == -75.0
    assert info.gain == 200.0
    assert info.ccd_temp_c == 32.0
    assert info.telescop == "S30_00000000"


def test_minimal_header_all_none():
    from astropy.io import fits

    h = fits.Header()
    h["SIMPLE"] = True
    h["BITPIX"] = 16
    h["NAXIS"] = 0
    info = parse_fits_header(h.tostring(endcard=True, padding=True).encode("ascii"))
    assert info.kind == "other"
    for f in ("object", "date_obs_utc", "exptime_s", "filter", "gain", "ccd_temp_c", "instrument",
              "telescop", "site_lat", "site_lon", "stack_count", "livetime_s", "expstart_jd",
              "expend_jd", "program"):
        assert getattr(info, f) is None


@pytest.mark.parametrize("bad", ["nan", "inf", "abc", 654.7])
def test_bad_stackcnt_is_none(bad):
    info = parse_fits_header(siril_stack_header(STACKCNT=bad))
    assert info.stack_count is None


def test_exptime_non_numeric_falls_back_to_exposure():
    info = parse_fits_header(seestar_sub_header(EXPTIME="n/a", EXPOSURE=10.0))
    assert info.exptime_s == 10.0


def test_is_ignored_more():
    assert is_ignored("a/b.lst") and is_ignored("a/b.TXT") and is_ignored("a/libx.dylib")
    assert is_ignored("a/PP_light_1.fit") and is_ignored("a/R_x.fit")


def test_malformed_iso_is_none(monkeypatch):
    import app.astrolog.headers as H

    class T:
        values = ["bad"]
        printable = "x"

    real = H.exifread.process_file
    monkeypatch.setattr(H.exifread, "process_file", lambda *a, **k: {"EXIF ISOSpeedRatings": T(), "Image Model": T()})
    assert H.parse_cr2_exif(b"x").iso is None
    monkeypatch.setattr(H.exifread, "process_file", real)


def test_fixture_honours_overrides():
    from astropy.io import fits

    data = seestar_sub_header(EXPTIME="n/a", EXPOSURE=10.0)
    assert fits.Header.fromstring(data.decode("ascii"), sep="")["EXPTIME"] == "n/a"
    assert parse_fits_header(data).exptime_s == 10.0
    other = parse_fits_header(seestar_sub_header(OBJECT="M 27", **{"DATE-OBS": "2026-01-02T03:04:05"}))
    assert other.object == "M 27"
    assert other.date_obs_utc == datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
