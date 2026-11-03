"""Final-picture decoding and metadata-free previews.

Decoders: JPEG/PNG via Pillow, TIFF via ``tifffile`` (8/16-bit and float; RGB or mono), FITS via
Astropy (first image HDU; 3 planes -> RGB). 16-bit and float data are auto-stretched with a
per-channel percentile clip (0.5-99.8) followed by asinh -- for recognition, not science.

Privacy: output JPEGs are re-encoded from a fresh pixel buffer (``exif=b""``, no ICC/XMP/comment),
so no EXIF/GPS/FITS header content can reach a preview or thumbnail.

``suggest_stack_id`` (here, used by Task 6's target page) picks the stack to pre-link a final image to.
"""

from __future__ import annotations

import io
from pathlib import PurePosixPath

import numpy as np
from PIL import Image, ImageOps
from sqlalchemy import select
from sqlalchemy.orm import Session

from .headers import parse_stack_filename
from .models import Stack

PREVIEW_EDGE = 1600
THUMB_EDGE = 400
MAX_PIXELS = 100_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS * 2  # bounded once at import; our own guard is stricter

PILLOW_EXT = {".jpg", ".jpeg", ".png"}
TIFF_EXT = {".tif", ".tiff"}
FITS_EXT = {".fit", ".fits", ".fts"}
SUPPORTED_EXT = PILLOW_EXT | TIFF_EXT | FITS_EXT


class UnsupportedImage(Exception):
    pass


class ImageTooLarge(Exception):
    pass


def format_of(filename: str) -> str:
    return PurePosixPath(filename.replace("\\", "/")).suffix.lower().lstrip(".")


def _stretch(a: np.ndarray) -> np.ndarray:
    """(H,W,C) float -> uint8; per-channel 0.5-99.8 percentile clip then asinh."""
    a = np.nan_to_num(a.astype(np.float32), nan=0.0, posinf=0.0, neginf=0.0)
    out = np.empty(a.shape, dtype=np.uint8)
    k = 10.0
    for c in range(a.shape[2]):
        ch = a[..., c]
        lo, hi = np.percentile(ch, [0.5, 99.8])
        if hi <= lo:
            hi = lo + 1.0
        x = np.clip((ch - lo) / (hi - lo), 0.0, 1.0)
        out[..., c] = np.round(np.arcsinh(x * k) / np.arcsinh(k) * 255).astype(np.uint8)
    return out


def _to_hwc(a: np.ndarray, fits_order: bool) -> np.ndarray:
    a = np.squeeze(a)
    if a.ndim == 2:
        a = a[..., None]
    elif a.ndim == 3 and a.shape[0] in (3, 4) and a.shape[-1] not in (3, 4):
        a = np.moveaxis(a, 0, -1)
    if a.ndim != 3 or a.shape[2] not in (1, 3, 4):
        raise UnsupportedImage("Unsupported image layout (expected mono or RGB).")
    if fits_order:
        a = a[::-1]  # FITS row 0 is the bottom of the image
    return a[..., :3] if a.shape[2] == 4 else a


def _array_to_rgb8(a: np.ndarray) -> np.ndarray:
    if a.dtype == np.uint8:
        rgb = a
    else:
        rgb = _stretch(a)
    return np.repeat(rgb, 3, axis=2) if rgb.shape[2] == 1 else rgb


def _check_pixels(w: int, h: int, max_pixels: int) -> None:
    if w * h > max_pixels:
        raise ImageTooLarge("Image has too many pixels to process.")


def _decode(data: bytes, ext: str, max_pixels: int) -> tuple[np.ndarray, str]:
    """Return ((H,W,3) uint8 array, format recognised from the content)."""
    try:
        if ext in PILLOW_EXT:
            im = Image.open(io.BytesIO(data), formats=("JPEG", "PNG"))
            if {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG"}[ext] != im.format:
                raise UnsupportedImage("File content does not match its extension.")
            fmt = im.format.lower()
            _check_pixels(im.width, im.height, max_pixels)
            im = ImageOps.exif_transpose(im) if im.format == "JPEG" else im
            if im.mode in ("I;16", "I;16B", "I;16L", "I", "F"):
                return _array_to_rgb8(_to_hwc(np.asarray(im), False)), fmt
            return np.asarray(im.convert("RGB")), fmt
        if ext in TIFF_EXT:
            import tifffile
            with tifffile.TiffFile(io.BytesIO(data)) as tf:
                shape = tf.series[0].shape
                dims = [d for d in shape if d > 4] or [1]
                _check_pixels(int(np.prod(dims)), 1, max_pixels)
                return _array_to_rgb8(_to_hwc(tf.series[0].asarray(), False)), "tiff"
        from astropy.io import fits
        with fits.open(io.BytesIO(data), memmap=False) as hdul:
            for hdu in hdul:
                if getattr(hdu, "is_image", False) and hdu.header.get("NAXIS", 0) >= 2:
                    dims = [d for d in hdu.shape if d > 4] or [1]
                    _check_pixels(int(np.prod(dims)), 1, max_pixels)
                    return _array_to_rgb8(_to_hwc(np.asarray(hdu.data), True)), "fits"
        raise UnsupportedImage("No image data found in the FITS file.")
    except (UnsupportedImage, ImageTooLarge):
        raise
    except (MemoryError, Image.DecompressionBombError) as exc:
        raise ImageTooLarge("Image too large to preview.") from exc
    except Exception as exc:  # corrupt/truncated input of any decoder
        raise UnsupportedImage("Could not read this image; it may be corrupt.") from exc


def _jpeg(rgb: np.ndarray, edge: int) -> bytes:
    im = Image.fromarray(np.ascontiguousarray(rgb), "RGB")
    im.thumbnail((edge, edge), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=88, optimize=True, exif=b"")
    return buf.getvalue()


def make_previews(data: bytes, filename: str, max_pixels: int = MAX_PIXELS) -> tuple[bytes, bytes, int, int, str]:
    """(preview JPEG, thumbnail JPEG, source width, source height, format from content);
    no metadata in outputs."""
    ext = "." + format_of(filename)
    if ext not in SUPPORTED_EXT:
        raise UnsupportedImage("Unsupported file type. Use JPEG, PNG, TIFF or FITS.")
    rgb, fmt = _decode(data, ext, max_pixels)
    h, w = rgb.shape[:2]
    return _jpeg(rgb, PREVIEW_EDGE), _jpeg(rgb, THUMB_EDGE), w, h, fmt


def suggest_stack_id(db: Session, library_target_id: str, final_filename: str) -> str | None:
    """Stack of this target whose frame count matches the one in the final image's filename
    (``<N>x<T>sec``), else the most recently imported stack of the target, else None."""
    stacks = list(db.scalars(select(Stack).where(Stack.library_target_id == library_target_id)
                             .order_by(Stack.imported_at.desc(), Stack.id)))
    if not stacks:
        return None
    parsed = parse_stack_filename(final_filename)
    if parsed:
        for s in stacks:
            sp = parse_stack_filename(s.source_filename)
            if (sp[0] if sp else s.stack_count) == parsed[0]:
                return s.id
    return stacks[0].id
