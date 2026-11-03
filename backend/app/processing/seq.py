"""Parsers for Siril 1.4.5 output: ``.seq`` sequence files and ``light_conversion.txt``.

Pure functions, no I/O. Implemented from the format description in the Phase 4
design spec (section 2a); no Siril source is copied. Absolute paths are never
returned: conversion results carry basenames only.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

SUPPORTED_SEQ_VERSIONS = {6}
_NOT_SEQ = "Not a Siril sequence file"


class SeqParseError(ValueError):
    pass


class KeptMappingError(ValueError):
    pass


@dataclass(frozen=True)
class RegData:
    fwhm: float
    wfwhm: float
    roundness: float
    quality: float
    background: float
    stars: int


@dataclass(frozen=True)
class SeqImage:
    index: int
    filenum: int
    selected: bool
    reg: RegData | None


@dataclass(frozen=True)
class SeqFile:
    name: str
    nb_images: int
    nb_selected: int
    reference: int  # 0-based index into images
    version: int
    images: tuple[SeqImage, ...]


_S_RE = re.compile(r"^S\s+'(.*)'\s+(.*)$")
_R_RE = re.compile(r"^R(\d)\s+(.*)$")


def _reg_from_tokens(tokens: list[str]) -> RegData | None:
    if len(tokens) < 6:
        raise SeqParseError("Malformed registration line in Siril sequence file")
    try:
        fwhm, wfwhm, roundness, quality, background = (float(t) for t in tokens[:5])
        stars = int(float(tokens[5]))
    except ValueError as e:
        raise SeqParseError("Malformed registration line in Siril sequence file") from e
    if fwhm == 0 and roundness == 0:  # Siril's own "no data" test
        return None
    return RegData(fwhm, wfwhm, roundness, quality, background, stars)


def parse_seq(text: str) -> SeqFile:
    lines = [ln.strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln and not ln.startswith("#")]
    header = None
    for ln in lines:
        m = _S_RE.match(ln)
        if m:
            header = m
            break
    if header is None:
        raise SeqParseError(_NOT_SEQ)
    name = header.group(1)
    try:
        f = [int(x) for x in header.group(2).split()]
    except ValueError as e:
        raise SeqParseError(_NOT_SEQ) from e
    if len(f) < 6:
        raise SeqParseError(_NOT_SEQ)
    _start, nb_images, nb_selected, _fixed_len, reference, version = f[:6]
    if version not in SUPPORTED_SEQ_VERSIONS:
        raise SeqParseError(
            f"Unsupported Siril sequence version {version}; only version 6 "
            "(written by Siril 1.4.5) is supported"
        )

    inclusion: list[tuple[int, bool]] = []
    layers: dict[int, list[RegData | None]] = {}
    for ln in lines:
        if ln.startswith("I "):
            parts = ln.split()
            try:
                inclusion.append((int(parts[1]), parts[2] == "1"))
            except (IndexError, ValueError) as e:
                raise SeqParseError("Malformed image line in Siril sequence file") from e
        else:
            m = _R_RE.match(ln)
            if m:
                layers.setdefault(int(m.group(1)), []).append(
                    _reg_from_tokens(m.group(2).split())
                )

    if len(inclusion) != nb_images:
        raise SeqParseError(
            f"Siril sequence declares {nb_images} images but lists {len(inclusion)}"
        )
    regs: list[RegData | None] = [None] * nb_images
    if layers:
        layer = 1 if 1 in layers else min(layers)
        data = layers[layer]
        if len(data) != nb_images:
            raise SeqParseError(
                f"Registration layer R{layer} has {len(data)} lines for {nb_images} images"
            )
        regs = data
    images = tuple(
        SeqImage(i, num, sel, regs[i]) for i, (num, sel) in enumerate(inclusion)
    )
    return SeqFile(name, nb_images, nb_selected, reference, version, images)


_CONV_RE = re.compile(r"^'(.*)'\s*->\s*'(.*)'\s*$")
_DEST_NUM_RE = re.compile(r"_(\d+)\.[A-Za-z0-9]+$")


def parse_conversion(text: str) -> dict[int, str]:
    """Map filenum -> source basename from ``light_conversion.txt``."""
    out: dict[int, str] = {}
    for ln in text.splitlines():
        m = _CONV_RE.match(ln.strip())
        if not m:
            continue
        dest = m.group(2).replace("\\", "/").rsplit("/", 1)[-1]
        n = _DEST_NUM_RE.search(dest)
        if not n:
            continue
        out[int(n.group(1))] = m.group(1).replace("\\", "/").rsplit("/", 1)[-1]
    return out


def kept_mask(reg: SeqFile, kept: SeqFile) -> list[bool]:
    """Which registration-sequence frames survive in the kept (r_) sequence.

    Matched by filenum. Statistics (not quality) are only a staleness check.
    """
    by_num: dict[int, tuple[int, RegData | None]] = {
        im.filenum: (pos, im.reg) for pos, im in enumerate(reg.images)
    }
    mask = [False] * len(reg.images)
    prev: int | None = None
    for im in kept.images:
        if prev is not None and im.filenum <= prev:
            raise KeptMappingError("Kept sequence file numbers are not strictly increasing")
        prev = im.filenum
        if im.filenum not in by_num:
            raise KeptMappingError(
                f"Kept frame {im.filenum} is not in the registration sequence (stale?)"
            )
        pos, src = by_num[im.filenum]
        a, b = src, im.reg
        if a is None or b is None or (
            (a.fwhm, a.wfwhm, a.roundness, a.background, a.stars)
            != (b.fwhm, b.wfwhm, b.roundness, b.background, b.stars)
        ):
            raise KeptMappingError(
                f"Kept frame {im.filenum} statistics differ from the registration sequence (stale?)"
            )
        mask[pos] = True
    return mask
