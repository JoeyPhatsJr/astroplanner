"""Stack measurement (coach-measure-2) on synthetic images with known answers.

Stars are rendered pixel-integrated (erf), i.e. exactly the circular-Gaussian PRF photutils fits, so the
known FWHM is the true answer rather than a sampled approximation.
"""
from __future__ import annotations

import io

import numpy as np
import pytest
from astropy.io import fits
from PIL import Image
from scipy.special import erf

from app.astrolog.previews import UnsupportedImage
from app.processing.measure import (
    HEADER_KEYS,
    METHOD,
    StackMeasurement,
    UnmeasurableStack,
    _read,
    coach_stretch,
    measure_stack,
)

FWHM_TRUE = 3.0


def _stars(h: int, w: int, fwhm: float, rng: np.random.Generator, spacing: int = 40) -> np.ndarray:
    """Isolated stars on a jittered grid, pixel-integrated circular Gaussians, unit-free amplitudes."""
    s = fwhm / (2.0 * np.sqrt(2.0 * np.log(2.0)))
    img = np.zeros((h, w), dtype=np.float64)
    edge_y = np.arange(h + 1) - 0.5
    edge_x = np.arange(w + 1) - 0.5
    for cy in range(spacing // 2, h - spacing // 2 + 1, spacing):
        for cx in range(spacing // 2, w - spacing // 2 + 1, spacing):
            y0 = cy + rng.uniform(-5, 5)
            x0 = cx + rng.uniform(-5, 5)
            flux = float(np.exp(rng.uniform(np.log(3000.0), np.log(30000.0))))
            iy = slice(max(0, int(y0) - 12), min(h, int(y0) + 13))
            ix = slice(max(0, int(x0) - 12), min(w, int(x0) + 13))
            ey = edge_y[iy.start:iy.stop + 1]
            ex = edge_x[ix.start:ix.stop + 1]
            py = np.diff(0.5 * erf((ey - y0) / (np.sqrt(2) * s)))
            px = np.diff(0.5 * erf((ex - x0) / (np.sqrt(2) * s)))
            img[iy, ix] += flux * np.outer(py, px)
    return img


def _image(
    h: int = 512,
    w: int = 512,
    noise: float = 5.0,
    bg: tuple[float, float, float] = (1000.0, 1000.0, 1000.0),
    ramp: float = 0.0,
    stars: bool = True,
    seed: int = 7,
) -> np.ndarray:
    """(3, H, W) float64 in FITS axis order: background + optional x ramp + stars + Gaussian noise."""
    rng = np.random.default_rng(seed)
    star = _stars(h, w, FWHM_TRUE, rng) if stars else np.zeros((h, w))
    xramp = np.linspace(0.0, ramp, w)[None, :]
    out = np.empty((3, h, w))
    for c in range(3):
        out[c] = bg[c] + xramp + star + rng.normal(0.0, noise, (h, w))
    return out


def _fits(data: np.ndarray, **header) -> bytes:
    hdu = fits.PrimaryHDU(data)
    for k, v in header.items():
        hdu.header[k] = v
    buf = io.BytesIO()
    hdu.writeto(buf)
    return buf.getvalue()


def _measure(data: np.ndarray, **header) -> StackMeasurement:
    m, _, _ = measure_stack(_fits(data.astype(np.float32), **header), "stack.fit")
    return m


@pytest.fixture(scope="module")
def base() -> np.ndarray:
    return _image()


@pytest.fixture(scope="module")
def base_m(base) -> StackMeasurement:
    return _measure(base)


def test_fwhm_of_known_stars(base_m):
    assert base_m.method == METHOD == "coach-measure-2"
    assert base_m.stars_measured >= 50
    assert base_m.star_fwhm_px == pytest.approx(FWHM_TRUE, abs=0.15)


def test_measurement_is_scale_free(base, base_m):
    m = _measure(base * 7.0 + 500.0)
    assert m.noise_frac == pytest.approx(base_m.noise_frac, rel=0.02)
    assert m.gradient_frac == pytest.approx(base_m.gradient_frac, rel=0.02, abs=1e-4)
    assert m.star_fwhm_px == pytest.approx(base_m.star_fwhm_px, rel=0.02)


def test_doubling_noise_doubles_noise_frac(base_m):
    m2 = _measure(_image(noise=10.0))
    assert base_m.noise_frac > 0
    assert m2.noise_frac / base_m.noise_frac == pytest.approx(2.0, rel=0.10)


def test_linear_ramp_is_a_gradient_without_residual(base_m):
    m = _measure(_image(ramp=300.0))
    assert m.gradient_frac > 0.1
    assert m.gradient_residual_frac < 0.02
    assert base_m.gradient_frac < 0.02  # flat control
    assert m.noise_frac == pytest.approx(base_m.noise_frac, rel=0.05)  # the background model removes it


@pytest.mark.parametrize("ramp", [10.0, 20.0])  # 2 and 4 per-channel noise sigma across the frame
def test_small_gradient_does_not_read_as_noise(base_m, ramp):
    m = _measure(_image(ramp=ramp))
    assert m.noise_frac == pytest.approx(base_m.noise_frac, rel=0.05)


def test_vignetting_does_not_read_as_noise(base_m):
    img = _image()
    yy, xx = np.mgrid[:512, :512]
    img -= 40.0 * (((yy - 256) ** 2 + (xx - 256) ** 2) / 256.0 ** 2)[None]  # darker corners, ~14 sigma
    m = _measure(img)
    assert m.noise_frac == pytest.approx(base_m.noise_frac, rel=0.05)


def test_zero_wedge_is_left_out():
    ramp = _image(ramp=20.0)
    ref = _measure(ramp)
    wedged = ramp.copy()
    wedged[:, :, : int(512 * 0.05)] = 0.0  # 5 % zero column, as registration leaves
    m = _measure(wedged)
    assert m.noise_frac == pytest.approx(ref.noise_frac, rel=0.03)
    assert m.gradient_frac == pytest.approx(ref.gradient_frac, rel=0.03)
    assert m.star_fwhm_px == pytest.approx(ref.star_fwhm_px, abs=0.05)


def test_green_biased_background(base_m):
    m = _measure(_image(bg=(1000.0, 1120.0, 1000.0)))
    assert m.bg_rgb_ratio is not None
    assert m.bg_rgb_ratio[1] > 1.05
    assert sum(m.bg_rgb_ratio) == pytest.approx(3.0)
    assert base_m.bg_rgb_ratio == pytest.approx((1.0, 1.0, 1.0), abs=0.01)


def test_header_facts(base):
    m = _measure(base, STACKCNT=654, LIVETIME=6540.0, EXPTIME=10.0, PROGRAM="Siril 1.4.4",
                 ROWORDER="BOTTOM-UP")
    assert (m.width, m.height, m.channels) == (512, 512, 3)
    assert m.stack_count == 654
    assert m.livetime_s == 6540.0
    assert m.exptime_s == 10.0
    assert m.program == "Siril 1.4.4"
    assert m.bayer is None


def test_missing_header_facts_are_none(base_m):
    assert (base_m.stack_count, base_m.livetime_s, base_m.exptime_s, base_m.program) == (None,) * 4


@pytest.mark.parametrize("roworder", [None, "BOTTOM-UP"])
def test_bayer_uint16_with_bzero(roworder):
    rgb = _image(h=1024, w=768, bg=(2800.0, 3600.0, 3200.0), noise=8.0)  # (3, H, W), green-biased
    # GRBG at stored pixel (0, 0): stored row 0 = G R, stored row 1 = B G (whatever ROWORDER says)
    cfa = np.empty(rgb.shape[1:])
    cfa[0::2, 0::2] = rgb[1, 0::2, 0::2]
    cfa[0::2, 1::2] = rgb[0, 0::2, 1::2]
    cfa[1::2, 0::2] = rgb[2, 1::2, 0::2]
    cfa[1::2, 1::2] = rgb[1, 1::2, 1::2]
    data = np.clip(np.round(cfa), 0, 65535).astype(np.uint16)
    header = {"BAYERPAT": "GRBG", "EXPTIME": 10.0} | ({"ROWORDER": roworder} if roworder else {})
    raw = _fits(data, **header)
    assert b"BZERO   =                32768" in raw
    m, preview, thumb = measure_stack(raw, "light.fits")
    assert m.bayer == "GRBG"
    assert (m.width, m.height, m.channels) == (768, 1024, 1)
    assert m.bg_rgb_ratio is not None
    assert m.bg_rgb_ratio == pytest.approx((2800 / 3200, 3600 / 3200, 3200 / 3200), abs=0.01)
    # stars measured on the half-size super-pixel image, reported in the file's pixels (x2); the 2x2 binning
    # widens them a little, so only a loose bound is a known answer here
    assert m.star_fwhm_px is not None and m.stars_measured >= 50
    assert m.star_fwhm_px == pytest.approx(FWHM_TRUE, abs=0.6)
    assert Image.open(io.BytesIO(preview)).size == (384, 512)  # super-pixel image


def test_header_allow_list_is_exact(base):
    raw = _fits(base.astype(np.float32), SITELAT=12.5, SITELONG=-98.5, OBJCTRA="1 2 3", DATE_OBS="2026-09-12",
                STACKCNT=3, ROWORDER="BOTTOM-UP")
    _, facts = _read(raw, 10**9)
    assert HEADER_KEYS == ("STACKCNT", "LIVETIME", "EXPTIME", "PROGRAM", "BAYERPAT", "ROWORDER")
    assert set(facts) == set(HEADER_KEYS)


def test_site_coordinates_never_reach_the_result(base):
    raw = _fits(base.astype(np.float32), SITELAT=12.3456789, SITELONG="-98.7654321", OBJCTRA="11 22 33")
    m, preview, thumb = measure_stack(raw, "stack.fits")
    text = repr(m)
    for needle in ("SITELAT", "SITELONG", "12.3456789", "98.7654321", "OBJCTRA", "11 22 33"):
        assert needle not in text
        assert needle.encode() not in preview and needle.encode() not in thumb


def test_previews_are_metadata_free_jpegs(base):
    _, preview, thumb = measure_stack(_fits(base.astype(np.float32), SITELAT=12.5), "stack.fit")
    for jpg, edge in ((preview, 1600), (thumb, 400)):
        im = Image.open(io.BytesIO(jpg))
        assert im.format == "JPEG"
        assert max(im.size) <= edge
        assert len(im.getexif()) == 0
        assert "exif" not in im.info and "icc_profile" not in im.info


@pytest.mark.parametrize("roworder, bright_on_top", [(None, True), ("BOTTOM-UP", False), ("TOP-DOWN", True)])
def test_preview_orientation_follows_roworder(roworder, bright_on_top):
    """Only a declared BOTTOM-UP is flipped: S30 lights and Siril 1.4.5 stacks carry no ROWORDER and store the
    top row first (checked on the real night against Siril 1.4.4's own TIFF export)."""
    img = _image(h=256, w=256)
    img[:, :64] += 400.0  # first stored rows
    header = {"ROWORDER": roworder} if roworder else {}
    _, preview, _ = measure_stack(_fits(img.astype(np.float32), **header), "s.fit")
    a = np.asarray(Image.open(io.BytesIO(preview)).convert("L"), dtype=float)
    top, bottom = a[:40].mean(), a[-40:].mean()
    assert bool(top > bottom) is bright_on_top


def test_coach_stretch_maps_median_to_quarter():
    rng = np.random.default_rng(3)
    a = np.stack([rng.normal(100.0 * (c + 1), 2.0 * (c + 1), (200, 300)) for c in range(3)], axis=-1)
    out = coach_stretch(a)
    assert out.dtype == np.uint8 and out.shape == a.shape
    for c in range(3):
        assert np.median(out[..., c]) == pytest.approx(0.25 * 255, abs=2)
    # black point is median - 2.8 sigma: about 0.26 % of a Gaussian background lies below it
    assert (out == 0).mean() == pytest.approx(0.0026, abs=0.002)


def test_coach_stretch_constant_channel_does_not_fail():
    out = coach_stretch(np.full((10, 10, 1), 5.0))
    assert out.dtype == np.uint8


def test_no_stars_gives_no_fwhm():
    m = _measure(_image(stars=False))
    assert m.star_fwhm_px is None
    assert m.stars_measured < 5


def test_rejects_non_fits_and_corrupt_and_flat():
    with pytest.raises(UnsupportedImage):
        measure_stack(b"not an image", "stack.png")
    with pytest.raises(UnsupportedImage):
        measure_stack(b"SIMPLE  = garbage", "stack.fit")
    with pytest.raises(UnmeasurableStack):
        measure_stack(_fits(np.full((3, 64, 64), 7.0, dtype=np.float32)), "stack.fit")
