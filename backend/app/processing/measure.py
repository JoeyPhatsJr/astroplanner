"""Stack measurement, method ``coach-measure-1`` (documented in docs/PROCESSING.md).

One fixed method, applied identically to any finished stack (Siril's, the Seestar's, the coach's), so two
stacks can be compared as "same method, relative". Every number is scale-free: it is expressed as a fraction
of the image's own signal scale ``P99.5 - median`` of the luminance, so multiplying an image by a constant or
adding an offset changes nothing, and stacks with different pixel units compare.

Pure: pixels are measured in memory only and nothing is stored. Header reading is an allow-list
(``STACKCNT``, ``LIVETIME``, ``EXPTIME``, ``PROGRAM``, ``BAYERPAT``, and ``ROWORDER`` for orientation);
astropy applies ``BZERO``/``BSCALE`` when it decodes the pixels. No other header value -- in particular no
site or sky coordinate -- is read into the result.

Orientation (checked on the real S30 night, see docs): rows are flipped for display only when the file says
``ROWORDER = 'BOTTOM-UP'``. Without the keyword, stored row 0 is shown at the top: that is how the S30 lights
and Siril 1.4.5's stack of them are stored (Siril 1.4.4's own TIFF export shows the same picture as its
``BOTTOM-UP`` stack flipped, and the 1.4.5 stack holds the same pixels with the rows reversed). ``BAYERPAT``
is the pattern of stored pixel (0, 0); the 2x2 super-pixel is formed before any flip (this reading
reproduces Siril's own debayer of an S30 light). Every reported number is a whole-image statistic, so only
the preview depends on orientation.
"""

from __future__ import annotations

import io
import warnings
from dataclasses import dataclass

import numpy as np

from app.astrolog.previews import (
    FITS_EXT,
    MAX_PIXELS,
    PREVIEW_EDGE,
    THUMB_EDGE,
    ImageTooLarge,
    UnsupportedImage,
    _check_pixels,
    _jpeg,
    _to_hwc,
    format_of,
)

METHOD = "coach-measure-1"

SCALE_PERCENTILE = 99.5      # signal scale = P99.5 - median of the luminance
BACKGROUND_PERCENTILE = 60   # background pixels: luminance strictly below its 60th percentile
MAD_TO_SIGMA = 1.4826        # Gaussian sigma from the median absolute deviation
TILES = 8                    # 8 x 8 tile medians for the background plane
DETECT_SIGMA = 5.0           # DAOStarFinder threshold, in background sigmas
DETECT_KERNEL_FWHM = 3.0     # DAOStarFinder kernel FWHM (px of the measured image)
MAX_STARS = 200              # at most this many stars are fitted (brightest isolated, unsaturated)
MIN_STARS = 5                # fewer fitted stars than this -> no FWHM reported
SATURATION_FRAC = 0.9        # a star whose peak reaches 90 % of the image maximum counts as saturated
FIT_SHAPE_MIN, FIT_SHAPE_MAX = 9, 25
BG_RING = 2                  # local background: median of a 2-px ring around each fit window
STRETCH_SHADOWS_SIGMA = 2.8  # preview black point = median - 2.8 sigma (per channel)
STRETCH_TARGET = 0.25        # preview: each channel's median maps to 25 % grey

BAYER_PATTERNS = ("RGGB", "BGGR", "GRBG", "GBRG")


class UnmeasurableStack(Exception):
    """The image has no usable signal range (e.g. constant), so no relative number can be formed."""


@dataclass(frozen=True)
class StackMeasurement:
    width: int
    height: int
    channels: int
    bayer: str | None
    stack_count: int | None
    livetime_s: float | None
    exptime_s: float | None
    program: str | None
    star_fwhm_px: float | None
    stars_measured: int
    noise_frac: float
    gradient_frac: float
    gradient_residual_frac: float
    bg_rgb_ratio: tuple[float, float, float] | None
    method: str = METHOD


# ---------------------------------------------------------------------------------------------- headers

def _int(v) -> int | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(f) if np.isfinite(f) and f == int(f) and f >= 0 else None


def _float(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if np.isfinite(f) and f >= 0 else None


def _str(v) -> str | None:
    if not isinstance(v, str):
        return None
    s = v.strip()
    return s[:80] or None


# ---------------------------------------------------------------------------------------------- pixels

def _superpixel(cfa: np.ndarray, pattern: str) -> np.ndarray:
    """(H, W) CFA in stored order -> (H//2, W//2, 3) RGB, the two greens averaged; no interpolation."""
    h, w = cfa.shape[0] // 2 * 2, cfa.shape[1] // 2 * 2
    cfa = cfa[:h, :w]
    planes: dict[str, list[np.ndarray]] = {"R": [], "G": [], "B": []}
    for ch, sub in zip(pattern, (cfa[0::2, 0::2], cfa[0::2, 1::2], cfa[1::2, 0::2], cfa[1::2, 1::2])):
        planes[ch].append(sub)
    r = planes["R"][0]
    g = (planes["G"][0] + planes["G"][1]) * 0.5
    b = planes["B"][0]
    return np.stack([r, g, b], axis=-1)


def _mad_sigma(x: np.ndarray) -> float:
    med = np.median(x)
    return float(MAD_TO_SIGMA * np.median(np.abs(x - med)))


def _tile_plane(lum: np.ndarray) -> tuple[float, float]:
    """(max - min of the fitted plane over the image, robust spread of tile medians about it), in counts."""
    h, w = lum.shape
    ys = np.linspace(0, h, TILES + 1).astype(int)
    xs = np.linspace(0, w, TILES + 1).astype(int)
    med, cy, cx = [], [], []
    for i in range(TILES):
        for j in range(TILES):
            tile = lum[ys[i]:ys[i + 1], xs[j]:xs[j + 1]]
            if tile.size == 0 or not np.isfinite(tile).any():
                continue
            med.append(float(np.nanmedian(tile)))
            cy.append((ys[i] + ys[i + 1] - 1) / 2.0)
            cx.append((xs[j] + xs[j + 1] - 1) / 2.0)
    z, cy, cx = np.array(med), np.array(cy), np.array(cx)
    if z.size < 3:
        return 0.0, 0.0
    a = np.column_stack([np.ones_like(cx), cx, cy])
    coef, *_ = np.linalg.lstsq(a, z, rcond=None)
    corners = np.array([[1, x, y] for x in (0, w - 1) for y in (0, h - 1)], dtype=float) @ coef
    resid = z - a @ coef
    return float(corners.max() - corners.min()), _mad_sigma(resid)


def _odd(n: float) -> int:
    k = int(np.ceil(n))
    return k if k % 2 else k + 1


def _fit_stars(src: np.ndarray, xy: np.ndarray, fit_shape: int, guess: float) -> np.ndarray:
    """FWHM of each star at ``xy`` with its own local background removed (median of a ring around the fit
    window). Stars are isolated, so their windows never overlap and one sparse image carries them all."""
    from photutils.psf import fit_fwhm

    half = fit_shape // 2
    outer = half + BG_RING
    sparse = np.zeros_like(src, dtype=np.float64)
    for x, y in xy:
        ix, iy = int(round(x)), int(round(y))
        box = src[iy - outer:iy + outer + 1, ix - outer:ix + outer + 1].astype(np.float64)
        ring = np.ones(box.shape, dtype=bool)
        ring[BG_RING:-BG_RING, BG_RING:-BG_RING] = False
        sparse[iy - half:iy + half + 1, ix - half:ix + half + 1] = (
            box[BG_RING:-BG_RING, BG_RING:-BG_RING] - np.median(box[ring]))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        f = np.asarray(fit_fwhm(sparse, xypos=xy, fwhm=guess, fit_shape=fit_shape), dtype=float)
    return f[np.isfinite(f) & (f > 0.5) & (f < fit_shape)]


def _select(src: np.ndarray, med: float, sigma: float, fit_shape: int) -> np.ndarray:
    """(x, y) of up to MAX_STARS brightest isolated, unsaturated 5-sigma DAOStarFinder detections."""
    from photutils.detection import DAOStarFinder

    data = src - med
    peak_max = SATURATION_FRAC * float(np.max(data))
    finder = DAOStarFinder(threshold=DETECT_SIGMA * sigma, fwhm=DETECT_KERNEL_FWHM, min_separation=0)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        tbl = finder(data)
    if tbl is None or len(tbl) == 0:
        return np.empty((0, 2))
    x = np.asarray(tbl["x_centroid"], dtype=float)
    y = np.asarray(tbl["y_centroid"], dtype=float)
    peak = np.asarray(tbl["peak"], dtype=float)
    flux = np.asarray(tbl["flux"], dtype=float)
    h, w = src.shape
    margin = fit_shape // 2 + BG_RING + 1
    ok = (x >= margin) & (x < w - margin) & (y >= margin) & (y < h - margin) & (peak < peak_max)
    # isolated: no other detection (bright or faint, saturated or not) within one fit-window width
    if len(x) > 1:
        from scipy.spatial import cKDTree

        tree = cKDTree(np.column_stack([x, y]))
        counts = np.array([len(n) for n in tree.query_ball_point(np.column_stack([x, y]), r=float(fit_shape))])
        ok &= counts == 1
    idx = np.flatnonzero(ok)
    idx = idx[np.argsort(-flux[idx], kind="stable")][:MAX_STARS]
    return np.column_stack([x[idx], y[idx]])


def _star_fwhm(lum: np.ndarray) -> tuple[float | None, int]:
    """Median FWHM (px of ``lum``) and the number of stars fitted. Detection uses the sigma-clipped
    (3 sigma, 5 iterations) median and standard deviation of the whole luminance: the noise_frac sigma comes
    from the lower 60 % of pixels only and so reads low (about 0.66 sigma for Gaussian noise), which would put
    a "5 sigma" threshold near 3.3 sigma and let noise peaks in."""
    from astropy.stats import sigma_clipped_stats

    fin = lum[np.isfinite(lum)]
    _, med, sigma = (float(v) for v in sigma_clipped_stats(fin, sigma=3.0, maxiters=5))
    if not sigma > 0:
        return None, 0
    src = np.where(np.isfinite(lum), lum, med)
    guess = DETECT_KERNEL_FWHM
    fit_shape = FIT_SHAPE_MIN
    fwhm: np.ndarray = np.empty(0)
    for _ in range(2):  # second pass only if the stars are wider than the first window suits
        xy = _select(src, med, sigma, fit_shape)
        if len(xy) < MIN_STARS:
            return None, 0
        fwhm = _fit_stars(src, xy, fit_shape, guess)
        if len(fwhm) < MIN_STARS:
            return None, len(fwhm)
        guess = float(np.median(fwhm))
        want = min(max(_odd(3.0 * guess), FIT_SHAPE_MIN), FIT_SHAPE_MAX)
        if want == fit_shape:
            break
        fit_shape = want
    return float(np.median(fwhm)), int(len(fwhm))


# ---------------------------------------------------------------------------------------------- stretch

def coach_stretch(a: np.ndarray) -> np.ndarray:
    """(H, W, C) float -> uint8, per channel: black point at median - 2.8 sigma (sigma = 1.4826 MAD), white
    point at the channel maximum, then a midtones transfer that puts the median at 25 % grey."""
    a = np.asarray(a, dtype=np.float32)
    out = np.zeros(a.shape, dtype=np.uint8)
    for c in range(a.shape[2]):
        ch = a[..., c]
        fin = ch[np.isfinite(ch)]
        if fin.size == 0:
            continue
        med = float(np.median(fin))
        sig = _mad_sigma(fin)
        black = max(med - STRETCH_SHADOWS_SIGMA * sig, float(fin.min()))
        white = float(fin.max())
        if white <= black:
            continue
        x = np.clip((np.nan_to_num(ch, nan=black) - black) / (white - black), 0.0, 1.0)
        xm = (med - black) / (white - black)
        if 0.0 < xm < 1.0:
            t = STRETCH_TARGET
            m = xm * (t - 1.0) / (2.0 * xm * t - xm - t)  # midtones balance with MTF(xm; m) = t
            x = (m - 1.0) * x / ((2.0 * m - 1.0) * x - m)
        out[..., c] = np.round(np.clip(x, 0.0, 1.0) * 255.0).astype(np.uint8)
    return out


# ---------------------------------------------------------------------------------------------- entry

def _read(data: bytes, max_pixels: int):
    from astropy.io import fits

    try:
        with fits.open(io.BytesIO(data), memmap=False) as hdul:
            for hdu in hdul:
                if getattr(hdu, "is_image", False) and hdu.header.get("NAXIS", 0) >= 2:
                    dims = [d for d in hdu.shape if d > 4] or [1]
                    _check_pixels(int(np.prod(dims)), 1, max_pixels)
                    hdr = hdu.header
                    facts = {k: hdr.get(k) for k in ("STACKCNT", "LIVETIME", "EXPTIME", "PROGRAM", "BAYERPAT",
                                                     "ROWORDER")}
                    return np.asarray(hdu.data), facts
    except (UnsupportedImage, ImageTooLarge):
        raise
    except MemoryError as exc:
        raise ImageTooLarge("Image too large to measure.") from exc
    except Exception as exc:  # corrupt/truncated FITS
        raise UnsupportedImage("Could not read this FITS file; it may be corrupt.") from exc
    raise UnsupportedImage("No image data found in the FITS file.")


def measure_stack(data: bytes, filename: str, max_pixels: int = MAX_PIXELS
                  ) -> tuple[StackMeasurement, bytes, bytes]:
    """Measure a finished stack (FITS) with method coach-measure-1; also return preview and thumbnail JPEGs
    made with :func:`coach_stretch` (metadata-free). Nothing is stored."""
    if "." + format_of(filename) not in FITS_EXT:
        raise UnsupportedImage("Stack measurement needs a FITS file (.fit, .fits, .fts).")
    raw, facts = _read(data, max_pixels)
    roworder = _str(facts["ROWORDER"])
    bottom_up = roworder is not None and roworder.upper() == "BOTTOM-UP"
    img = _to_hwc(raw, fits_order=False).astype(np.float32)  # stored order; flipped below if declared
    height, width, channels = img.shape
    pattern = _str(facts["BAYERPAT"])
    bayer = pattern.upper() if pattern and pattern.upper() in BAYER_PATTERNS else None

    super_px = channels == 1 and bayer is not None and height >= 2 and width >= 2
    if super_px:
        img = _superpixel(img[..., 0], bayer)  # BAYERPAT is the pattern at stored pixel (0, 0)
    if bottom_up:
        img = img[::-1]
    lum = img.mean(axis=2) if img.shape[2] > 1 else img[..., 0]

    fin = lum[np.isfinite(lum)]
    if fin.size < 16:
        raise UnmeasurableStack("The image has no measurable pixels.")
    med, top = (float(v) for v in np.percentile(fin, [50, SCALE_PERCENTILE]))
    scale = top - med
    if not scale > 0:
        raise UnmeasurableStack("The image has no signal range to measure against.")
    bg_cut = float(np.percentile(fin, BACKGROUND_PERCENTILE))
    bg_mask = np.isfinite(lum) & (lum < bg_cut)
    if bg_mask.sum() < 16:
        bg_mask = np.isfinite(lum) & (lum <= bg_cut)
    sigma = _mad_sigma(lum[bg_mask])

    plane_range, plane_resid = _tile_plane(lum)
    fwhm, n_stars = _star_fwhm(lum)
    if fwhm is not None and super_px:
        fwhm *= 2.0  # back to the file's pixels

    ratio = None
    if img.shape[2] == 3:
        meds = np.array([float(np.median(img[..., c][bg_mask])) for c in range(3)])
        mean = meds.mean()
        if mean > 0 and np.all(np.isfinite(meds)):
            ratio = tuple(float(v) for v in meds / mean)

    m = StackMeasurement(
        width=int(width), height=int(height), channels=int(channels), bayer=bayer,
        stack_count=_int(facts["STACKCNT"]), livetime_s=_float(facts["LIVETIME"]),
        exptime_s=_float(facts["EXPTIME"]), program=_str(facts["PROGRAM"]),
        star_fwhm_px=fwhm, stars_measured=n_stars,
        noise_frac=sigma / scale, gradient_frac=plane_range / scale, gradient_residual_frac=plane_resid / scale,
        bg_rgb_ratio=ratio,  # type: ignore[arg-type]
    )
    rgb = coach_stretch(img)
    if rgb.shape[2] == 1:
        rgb = np.repeat(rgb, 3, axis=2)
    return m, _jpeg(rgb, PREVIEW_EDGE), _jpeg(rgb, THUMB_EDGE)
