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
    assert info.expstart_jd == pytest.approx(2461294.63)


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
