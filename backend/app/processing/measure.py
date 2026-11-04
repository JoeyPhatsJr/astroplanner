"""Stack measurement, method ``coach-measure-2`` (documented in docs/PROCESSING.md).

One fixed method, applied identically to any finished stack (Siril's, the Seestar's, the coach's), so two
stacks can be compared as "same method, relative". Every number is scale-free: it is expressed as a fraction
of the image's own signal scale ``P99.5 - median`` of the luminance, so multiplying an image by a constant or
adding an offset changes nothing, and stacks with different pixel units compare. Pixels that are exactly 0 or
not finite (registration / field-rotation wedges) are left out of every statistic.

Pure: pixels are measured in memory only and nothing is stored. Header reading is an allow-list
(``STACKCNT``, ``LIVETIME``, ``EXPTIME``, ``PROGRAM``, ``BAYERPAT``, ``ROWORDER`` for orientation, and ``HISTORY``,
searched only for the phrase "equalized RGB" and otherwise discarded);
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
from astropy.stats import sigma_clipped_stats

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

METHOD = "coach-measure-2"  # -1 took the noise MAD over raw background pixels; gradients inflated it

MIN_EDGE = 64                # stacks smaller than this on either side are refused: the 8 x 8 tile grid degenerates

# The only header keys read; widening this list is a deliberate, reviewed change (a test pins it).
HEADER_KEYS = ("STACKCNT", "LIVETIME", "EXPTIME", "PROGRAM", "BAYERPAT", "ROWORDER", "HISTORY")

SCALE_PERCENTILE = 99.5      # brightness range = P99.5 - median of the luminance
BACKGROUND_PERCENTILE = 60   # colour-balance pixels: luminance strictly below its 60th percentile
MAD_TO_SIGMA = 1.4826        # Gaussian sigma from the median absolute deviation
TILES = 8                    # 8 x 8 tile medians: background model (bilinear) and gradient plane
TILE_MIN_VALID = 0.1         # a tile with fewer valid pixels than this fraction has no median of its own
CLIP_SIGMA, CLIP_ITERS = 3.0, 5  # sigma clipping of the background-subtracted luminance
DETECT_SIGMA = 5.0           # DAOStarFinder threshold, in noise sigmas (the noise_frac sigma)
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
    rgb_equalized: bool | None = None  # True when HISTORY says Siril equalized RGB while stacking; None = not stated


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


def _tile_grid(lum: np.ndarray, valid: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(TILES x TILES medians of the valid pixels, NaN where a tile has too few; row centres; column centres)."""
    h, w = lum.shape
    ys = np.linspace(0, h, TILES + 1).astype(int)
    xs = np.linspace(0, w, TILES + 1).astype(int)
    z = np.full((TILES, TILES), np.nan)
    for i in range(TILES):
        for j in range(TILES):
            tile = lum[ys[i]:ys[i + 1], xs[j]:xs[j + 1]]
            ok = valid[ys[i]:ys[i + 1], xs[j]:xs[j + 1]]
            if tile.size and ok.sum() >= max(1, TILE_MIN_VALID * tile.size):
                z[i, j] = float(np.median(tile[ok]))
    return z, (ys[:-1] + ys[1:] - 1) / 2.0, (xs[:-1] + xs[1:] - 1) / 2.0


def _plane(z: np.ndarray, cy: np.ndarray, cx: np.ndarray, h: int, w: int) -> tuple[float, float]:
    """(max - min of the least-squares plane through the tile medians at the image corners, 1.4826 MAD of the
    tile medians about the plane), in counts."""
    gy, gx = np.meshgrid(cy, cx, indexing="ij")
    ok = np.isfinite(z)
    if ok.sum() < 3:
        return 0.0, 0.0
    a = np.column_stack([np.ones(ok.sum()), gx[ok], gy[ok]])
    coef, *_ = np.linalg.lstsq(a, z[ok], rcond=None)
    corners = np.array([[1, x, y] for x in (0, w - 1) for y in (0, h - 1)], dtype=float) @ coef
    return float(corners.max() - corners.min()), _mad_sigma(z[ok] - a @ coef)


def _interp_weights(centres: np.ndarray, n: int) -> np.ndarray:
    """(n, len(centres)) linear interpolation weights, extrapolating linearly past the outer centres."""
    k = len(centres)
    wts = np.zeros((n, k))
    pos = np.arange(n, dtype=float)
    if k == 1:
        wts[:, 0] = 1.0
        return wts
    i = np.clip(np.searchsorted(centres, pos) - 1, 0, k - 2)
    t = (pos - centres[i]) / (centres[i + 1] - centres[i])
    wts[np.arange(n), i] = 1.0 - t
    wts[np.arange(n), i + 1] = t
    return wts


def _background_model(z: np.ndarray, cy: np.ndarray, cx: np.ndarray, h: int, w: int) -> np.ndarray:
    """Bilinear surface through the tile medians (tiles without a median take their nearest tile's)."""
    from scipy.ndimage import distance_transform_edt

    miss = ~np.isfinite(z)
    if miss.all():
        return np.zeros((h, w))
    if miss.any():
        _, (iy, ix) = distance_transform_edt(miss, return_indices=True)
        z = z[iy, ix]
    return _interp_weights(cy, h) @ z @ _interp_weights(cx, w).T


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


def _select(data: np.ndarray, valid: np.ndarray, sigma: float, fit_shape: int) -> np.ndarray:
    """(x, y) of up to MAX_STARS brightest isolated, unsaturated 5-sigma DAOStarFinder detections on the
    background-subtracted luminance ``data`` (invalid pixels already set to 0)."""
    from photutils.detection import DAOStarFinder

    peak_max = SATURATION_FRAC * float(np.max(data[valid]))
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
    h, w = data.shape
    margin = fit_shape // 2 + BG_RING + 1
    ok = (x >= margin) & (x < w - margin) & (y >= margin) & (y < h - margin) & (peak < peak_max)
    # isolated: no other detection (bright or faint, saturated or not) within one fit-window width
    if len(x) > 1:
        from scipy.spatial import cKDTree

        tree = cKDTree(np.column_stack([x, y]))
        counts = np.array([len(n) for n in tree.query_ball_point(np.column_stack([x, y]), r=float(fit_shape))])
        ok &= counts == 1
    outer = fit_shape // 2 + BG_RING
    for k in np.flatnonzero(ok):  # the fit window and its ring must lie wholly on valid pixels
        ix, iy = int(round(x[k])), int(round(y[k]))
        ok[k] = bool(valid[iy - outer:iy + outer + 1, ix - outer:ix + outer + 1].all())
    idx = np.flatnonzero(ok)
    idx = idx[np.argsort(-flux[idx], kind="stable")][:MAX_STARS]
    return np.column_stack([x[idx], y[idx]])


def _star_fwhm(resid: np.ndarray, valid: np.ndarray, sigma: float) -> tuple[float | None, int]:
    """Median FWHM (px of ``resid``) and the number of stars fitted. ``resid`` is the luminance minus the
    background model, ``sigma`` the same noise sigma that noise_frac reports."""
    if not sigma > 0:
        return None, 0
    data = np.where(valid, resid, 0.0)
    guess = DETECT_KERNEL_FWHM
    fit_shape = FIT_SHAPE_MIN
    fwhm: np.ndarray = np.empty(0)
    for _ in range(2):  # second pass only if the stars are wider than the first window suits
        xy = _select(data, valid, sigma, fit_shape)
        if len(xy) < MIN_STARS:
            return None, 0
        fwhm = _fit_stars(data, xy, fit_shape, guess)
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
    point at the channel maximum, then a midtones transfer that puts the median at 25 % grey. Statistics leave
    out pixels that are exactly 0 or not finite (those pixels still get drawn, clipped to black)."""
    a = np.asarray(a, dtype=np.float32)
    out = np.zeros(a.shape, dtype=np.uint8)
    for c in range(a.shape[2]):
        ch = a[..., c]
        fin = ch[np.isfinite(ch) & (ch != 0)]
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
                    facts = {k: hdr.get(k) for k in HEADER_KEYS if k != "HISTORY"}
                    # Siril wraps HISTORY text across 72-character cards, even mid-word: join without separators.
                    facts["HISTORY"] = "".join(str(x) for x in hdr.get("HISTORY", []))
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
    """Measure a finished stack (FITS) with method coach-measure-2; also return preview and thumbnail JPEGs
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
    if min(img.shape[:2]) < MIN_EDGE:  # after the 2 x 2 super-pixel: this is the image the 8 x 8 grid sees
        raise UnmeasurableStack(f"The image is {img.shape[1]} x {img.shape[0]} px when measured; the coach needs "
                                f"at least {MIN_EDGE} px on each side to measure a stack (a colour-mosaic file "
                                "is halved on each side first).")
    if bottom_up:
        img = img[::-1]
    lum = img.mean(axis=2) if img.shape[2] > 1 else img[..., 0]

    valid = np.isfinite(lum) & (lum != 0)  # exact zeros: registration / field-rotation wedges
    fin = lum[valid]
    if fin.size < 16:
        raise UnmeasurableStack("The image has no measurable pixels.")
    med, top = (float(v) for v in np.percentile(fin, [50, SCALE_PERCENTILE]))
    scale = top - med
    if not scale > 0:
        raise UnmeasurableStack("The image has no signal range to measure against.")

    h, w = lum.shape
    z, cy, cx = _tile_grid(lum, valid)
    plane_range, plane_resid = _plane(z, cy, cx, h, w)
    resid = lum - _background_model(z, cy, cx, h, w)
    _, _, sigma = (float(v) for v in sigma_clipped_stats(resid[valid], sigma=CLIP_SIGMA, maxiters=CLIP_ITERS))

    try:
        fwhm, n_stars = _star_fwhm(resid, valid, sigma)
    except Exception:  # noqa: BLE001 - a photutils/scipy failure on unusual data is "too few usable stars"
        fwhm, n_stars = None, 0  # (no FWHM), the same outcome as a star-poor image, never a failed upload
    if fwhm is not None and super_px:
        fwhm *= 2.0  # back to the file's pixels

    ratio = None
    if img.shape[2] == 3:
        bg_mask = valid & (lum < float(np.percentile(fin, BACKGROUND_PERCENTILE)))
        if bg_mask.sum() < 16:
            bg_mask = valid
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
        rgb_equalized=True if "equalized rgb" in (facts["HISTORY"] or "").lower() else None,
    )
    rgb = coach_stretch(img)
    if rgb.shape[2] == 1:
        rgb = np.repeat(rgb, 3, axis=2)
    return m, _jpeg(rgb, PREVIEW_EDGE), _jpeg(rgb, THUMB_EDGE)
