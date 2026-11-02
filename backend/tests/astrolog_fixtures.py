"""Synthetic FITS header builders for Astrolog tests (dummy coordinates only)."""

from __future__ import annotations

from typing import Any

from astropy.io import fits


def _to_bytes(header: fits.Header) -> bytes:
    raw = header.tostring(sep="", endcard=True, padding=True).encode("ascii")
    if len(raw) % 2880:
        raw += b" " * (2880 - len(raw) % 2880)
    return raw


def _base(overrides: dict[str, Any]) -> fits.Header:
    h = fits.Header()
    h["SIMPLE"] = True
    h["BITPIX"] = 16
    h["NAXIS"] = 2
    h["NAXIS1"] = 1080
    h["NAXIS2"] = 1920
    h["CREATOR"] = "ZWO Seestar S30"
    h["INSTRUME"] = "Seestar S30"
    h["TELESCOP"] = "S30_00000000"
    h["IMAGETYP"] = "Light"
    h["RA"] = 349.0
    h["DEC"] = 61.2
    h["FILTER"] = "LP"
    h["GAIN"] = 200
    h["CCD-TEMP"] = 32.0
    h["FOCALLEN"] = 150
    h["XPIXSZ"] = 2.9
    h["SITELAT"] = 40.0
    h["SITELONG"] = -75.0
    for k, v in overrides.items():
        h[k.replace("_", "-") if k == "CCD_TEMP" else k] = v
    return h


def seestar_sub_header(
    object: str = "NGC 7635", date_obs: str = "2026-09-12T03:11:24.634198", exptime: float = 10.0, **overrides: Any
) -> bytes:
    h = _base(overrides)
    h["OBJECT"] = object
    h["DATE-OBS"] = date_obs
    h["EXPTIME"] = exptime
    h["EXPOSURE"] = exptime
    for k, v in overrides.items():
        h[k.replace("_", "-") if k == "CCD_TEMP" else k] = v
    return _to_bytes(h)


def siril_stack_header(stack_count: int = 654, livetime: float = 6540.0, **overrides: Any) -> bytes:
    h = _base(overrides)
    h["BITPIX"] = -32
    h["NAXIS"] = 3
    h["NAXIS3"] = 3
    h["OBJECT"] = "NGC 7635"
    h["DATE-OBS"] = "2026-09-12T03:11:24.634198"
    h["EXPTIME"] = 10.0
    h["PROGRAM"] = "Siril 1.4.4"
    h["STACKCNT"] = stack_count
    h["LIVETIME"] = livetime
    h["EXPSTART"] = 2461294.63
    h["EXPEND"] = 2461294.9
    h["HISTORY"] = "Stacking method: average with rejection"
    for k, v in overrides.items():
        h[k] = v
    return _to_bytes(h)
