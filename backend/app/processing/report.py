"""Night report: what Siril's own files say about one night, plus fixed-rule findings.

Pure functions, no I/O and no pixels: the inputs are the text of Siril's ``.seq`` files and
``light_conversion.txt`` (read in the browser) and the frame times from the AstroLog import. Only basenames and
the working-folder name are kept; the absolute source paths inside the conversion file are dropped on parse.

Frame times come only from ``CaptureFrame.date_obs_utc`` (the FITS ``DATE-OBS``), never from the local time in a
file name. Bins are floored in UTC and labelled in the night location's IANA timezone, so the two 01:00 half-hours
of a DST fall-back night stay apart.

Findings follow fixed rules (documented with their constants in ``docs/PROCESSING.md``). A cause is only ever the
low-altitude one, only when the app's own altitude computation supports it, and only in ``detail`` as
"Possible causes: ...". Nothing here scores the night.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Sequence
from zoneinfo import ZoneInfo

from .models import Basis
from .seq import KeptMappingError, SeqFile, SeqParseError, kept_mask, parse_conversion, parse_seq

# Heuristic constants (rules of thumb, not Siril limits); each is listed in docs/PROCESSING.md.
MIN_MATCH_FRACTION = 0.5  # share of the sequence's frames that must match this night's imported frames
LOW_STARS = 50  # median stars per aligned frame below which the night counts as star-poor
SPLIT_HIGH = 0.85  # a "good" part of the night keeps at least this share of its frames
SPLIT_LOW = 0.60  # a "poor" part of the night keeps at most this share
LOW_ALT_DEG = 30  # altitude below which low altitude is offered as a possible cause

BACKGROUND_UNITS = "Siril units, relative"  # ADU for 16-bit sequences, 0 to 1 for debayered float ones
CONVERSION_SUFFIX = "_conversion.txt"
AltitudeFn = Callable[[list[str]], Sequence[float]]


class FolderError(ValueError):
    """The uploaded folder cannot give a report for this night; the message is shown to the user."""


@dataclass(frozen=True)
class UploadedText:
    path: str  # relative, e.g. "process/pp_light_.seq"; only its last component is ever used
    text: str


@dataclass
class FrameStat:
    n: int  # Siril filenum (the number in light_00007.fit)
    basename: str | None
    utc: str | None
    aligned: bool
    kept: bool | None  # None when no usable kept (r_) sequence was uploaded
    fwhm: float | None
    wfwhm: float | None
    roundness: float | None
    background: float | None
    stars: int | None
    exptime_s: float | None = None  # from the matched AstroLog frame, when known


@dataclass
class FolderResult:
    run_dir: str
    registration_seq: str
    kept_seq: str | None
    seq_version: int
    frames: list[FrameStat]
    matched: int
    kept_error: str | None
    calibration_dirs: list[str]

    def to_store(self) -> tuple[dict[str, Any], dict[str, Any]]:
        """(``ProcessingRun.folder``, ``ProcessingRun.frame_stats``): names and Siril numbers only."""
        folder = {k: v for k, v in asdict(self).items() if k != "frames"}
        return folder, {"frames": [asdict(f) for f in self.frames]}

    @classmethod
    def from_store(cls, folder: dict[str, Any], frame_stats: dict[str, Any]) -> FolderResult:
        return cls(**folder, frames=[FrameStat(**f) for f in frame_stats.get("frames", [])])


@dataclass
class Bin:
    start_utc: str
    label_local: str
    captured: int
    aligned: int
    kept: int | None


@dataclass
class Finding:
    id: str
    title: str
    detail: str
    basis: Basis
    heuristic: bool
    value: float | None = None  # the round_cut threshold, reused by the selection step


@dataclass
class Report:
    totals: dict[str, Any]
    medians: dict[str, float | None]
    ranges: dict[str, list[int] | None]
    bins: list[Bin]
    findings: list[Finding]
    time_unknown: int
    timezone: str | None  # None: bin labels are in UTC
    units: dict[str, str] = field(default_factory=lambda: {
        "fwhm": "px", "wfwhm": "px", "background": BACKGROUND_UNITS})


# ---- folder ------------------------------------------------------------------------------------

def _name(path: str) -> str:
    return path.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1].strip()


def _clean_dirs(dirs: Sequence[str]) -> list[str]:
    out: list[str] = []
    for d in dirs:
        nm = _name(d)[:64]
        if nm and nm not in (".", "..") and nm not in out:
            out.append(nm)
    return out


def _pick_conversion(conversions: dict[str, dict[int, str]], reg_name: str) -> dict[int, str]:
    if not conversions:
        raise FolderError("This folder has no light_conversion.txt, which the coach needs to match Siril's "
                          "numbered frames to your light frames.")
    matching = [k for k in conversions if reg_name.endswith(f"{k}_")]
    if matching:
        return conversions[max(matching, key=len)]
    if len(conversions) == 1:
        return next(iter(conversions.values()))
    raise FolderError(f"Several conversion files in this folder and none matches {reg_name}.seq.")


def build_folder(
    files: Sequence[UploadedText],
    calibration_dirs: Sequence[str],
    frame_times: dict[str, str],
    *,
    run_dir: str | None = None,
    frame_exptimes: dict[str, float] | None = None,
) -> FolderResult:
    """Read one Siril working folder's text files into per-frame statistics for this night.

    ``frame_times`` maps light-frame basename to its UTC ``DATE-OBS`` (from the AstroLog import).
    Raises ``SeqParseError`` or ``FolderError`` with a message for the user.
    """
    seqs: dict[str, SeqFile] = {}
    seq_dir: dict[str, str] = {}
    conversions: dict[str, dict[int, str]] = {}
    for f in files:
        nm = _name(f.path)
        if nm.lower().endswith(".seq"):
            try:
                seqs[nm[:-4]] = parse_seq(f.text)
            except SeqParseError as e:
                raise SeqParseError(f"{nm}: {e}") from e
            parts = f.path.replace("\\", "/").rstrip("/").split("/")
            seq_dir[nm[:-4]] = parts[-2] if len(parts) > 1 else ""
        elif nm.endswith(CONVERSION_SUFFIX):
            conversions[nm[: -len(CONVERSION_SUFFIX)]] = parse_conversion(f.text)
    if not seqs:
        raise FolderError("No Siril sequence (.seq) file in this folder.")

    registered = [(k, s) for k, s in seqs.items()
                  if not k.startswith("r_") and any(im.reg is not None for im in s.images)]
    if not registered:
        raise FolderError("None of the sequences in this folder has registration data yet; run the align step, "
                          "then choose the folder again.")
    reg_name, reg = max(registered, key=lambda kv: (kv[1].nb_images, len(kv[0]), kv[0]))
    conv = _pick_conversion(conversions, reg_name)

    rd = _name(run_dir if run_dir is not None else seq_dir.get(reg_name, ""))
    if rd in ("", ".", ".."):
        raise FolderError("The Siril working folder's name is missing.")

    kept_name = f"r_{reg_name}"
    mask: list[bool] | None = None
    kept_error: str | None = None
    if kept_name in seqs:
        try:
            mask = kept_mask(reg, seqs[kept_name])
        except KeptMappingError as e:
            kept_error = (f"Couldn't tell which frames were kept: {e}. {kept_name}.seq doesn't match "
                          f"{reg_name}.seq; re-run the stacking script, then choose the folder again.")

    exps = frame_exptimes or {}
    frames: list[FrameStat] = []
    for im in reg.images:
        bn = conv.get(im.filenum)
        r = im.reg
        frames.append(FrameStat(
            n=im.filenum, basename=bn, utc=frame_times.get(bn) if bn else None, aligned=r is not None,
            kept=mask[im.index] if mask is not None else None,
            fwhm=r.fwhm if r else None, wfwhm=r.wfwhm if r else None, roundness=r.roundness if r else None,
            background=r.background if r else None, stars=r.stars if r else None,
            exptime_s=exps.get(bn) if bn else None))
    if not frames:
        raise FolderError(f"{reg_name}.seq lists no frames.")
    matched = sum(1 for f in frames if f.basename is not None and f.basename in frame_times)
    if matched < MIN_MATCH_FRACTION * len(frames):
        raise FolderError(f"This Siril folder doesn't look like this night's frames ({matched} of {len(frames)} match)")
    return FolderResult(run_dir=rd, registration_seq=reg_name, kept_seq=kept_name if kept_name in seqs else None,
                        seq_version=reg.version, frames=frames, matched=matched, kept_error=kept_error,
                        calibration_dirs=_clean_dirs(calibration_dirs))


# ---- report ------------------------------------------------------------------------------------

def _ts(utc: str) -> float:
    t = datetime.fromisoformat(utc.replace("Z", "+00:00"))
    return (t if t.tzinfo else t.replace(tzinfo=timezone.utc)).timestamp()


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _label(ts: float, tz: str | None) -> str:
    return datetime.fromtimestamp(ts, tz=ZoneInfo(tz) if tz else timezone.utc).strftime("%H:%M")


def _pct(k: int, n: int) -> int:
    """Whole percent, half up, but never "100" unless all and never "0" unless none."""
    p = math.floor(100 * k / n + 0.5)
    if k < n:
        p = min(p, 99)
    if k > 0:
        p = max(p, 1)
    return p


def _plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else many


def separating_cut(highest_dropped: float, lowest_kept: float) -> float:
    """The midpoint, at the fewest decimals (2 or more) that lies above every dropped frame and strictly below
    every kept one, so "dropped frames were below v" holds and Siril's ``>= v`` keeps the kept frames even after it
    rounds their roundness to single precision (a limit equal to a kept value could drop that frame)."""
    mid = (highest_dropped + lowest_kept) / 2
    for dp in range(2, 10):
        v = round(mid, dp)
        if highest_dropped < v < lowest_kept:
            return v
    return mid


def _bins(timed: list[tuple[float, FrameStat]], tz: str | None, minutes: int, kept_known: bool) -> list[Bin]:
    if not timed:
        return []
    width = minutes * 60
    first = math.floor(timed[0][0] / width) * width
    last = math.floor(timed[-1][0] / width) * width
    out: list[Bin] = []
    i = 0
    for start in range(int(first), int(last) + 1, width):
        members = []
        while i < len(timed) and timed[i][0] < start + width:
            members.append(timed[i][1])
            i += 1
        out.append(Bin(start_utc=_iso(start), label_local=_label(start, tz), captured=len(members),
                       aligned=sum(1 for f in members if f.aligned),
                       kept=sum(1 for f in members if f.kept) if kept_known else None))
    return out


def _minute_grid(t0: float, t1: float) -> list[float]:
    start = math.ceil(t0 / 60) * 60
    return [float(t) for t in range(int(start), int(t1) + 1, 60)]


def _altitude_cause(before: list[tuple[float, FrameStat]], after: list[tuple[float, FrameStat]], low_first: bool,
                    altitude: AltitudeFn, tz: str | None) -> str | None:
    """'Possible causes: ...' only when the app's altitude says the target was below LOW_ALT_DEG for every
    frame of the poor part and at or above it for at least half of the good part's frames."""
    low, high = (before, after) if low_first else (after, before)
    if any(a >= LOW_ALT_DEG for a in altitude([f.utc for _, f in low])):
        return None
    if 2 * sum(1 for a in altitude([f.utc for _, f in high]) if a >= LOW_ALT_DEG) < len(high):
        return None
    if low_first:  # rising: first whole minute after the poor part at or above the limit
        grid = _minute_grid(low[-1][0], high[-1][0])
        alts = list(altitude([_iso(t) for t in grid])) if grid else []
        hit = next((t for t, a in zip(grid, alts) if a >= LOW_ALT_DEG), None)
        if hit is None:
            return None
        return f"Possible causes: the target was below {LOW_ALT_DEG}° until {_label(hit, tz)}."
    # setting: first whole minute below the limit, searched from the good part's first frame
    grid = _minute_grid(high[0][0], low[0][0]) + [low[0][0]]
    alts = list(altitude([_iso(t) for t in grid]))
    hit = next((t for t, a in zip(grid, alts) if a < LOW_ALT_DEG), None)
    if hit is None:
        return None
    return f"Possible causes: the target was below {LOW_ALT_DEG}° from {_label(hit, tz)} on."


def _time_split(timed: list[tuple[float, FrameStat]], bins: list[Bin], folder: FolderResult, tz: str | None,
                time_unknown: int, altitude: AltitudeFn | None) -> Finding | None:
    """Two-part split of the night at a bin boundary: among boundaries where one side keeps at most SPLIT_LOW
    and the other at least SPLIT_HIGH of its frames, the one with the largest between-part variance
    (n1*n2/(n1+n2) * (p1-p2)^2; earliest on ties)."""
    best: tuple[float, float, int] | None = None  # (score, -boundary, index)
    for b in bins[1:]:
        bt = _ts(b.start_utc)
        cut = next((j for j, (t, _) in enumerate(timed) if t >= bt), len(timed))
        n1, n2 = cut, len(timed) - cut
        if n1 == 0 or n2 == 0:
            continue
        p1 = sum(1 for _, f in timed[:cut] if f.kept) / n1
        p2 = sum(1 for _, f in timed[cut:] if f.kept) / n2
        if not ((p1 <= SPLIT_LOW and p2 >= SPLIT_HIGH) or (p1 >= SPLIT_HIGH and p2 <= SPLIT_LOW)):
            continue
        score = n1 * n2 / (n1 + n2) * (p1 - p2) ** 2
        if best is None or score > best[0]:
            best = (score, -bt, cut)
    if best is None:
        return None
    bt, cut = -best[1], best[2]
    before, after = timed[:cut], timed[cut:]
    k1, k2 = sum(1 for _, f in before if f.kept), sum(1 for _, f in after if f.kept)
    lab = _label(bt, tz) + ("" if tz else " UTC")
    title = (f"Before {lab}, {_pct(k1, len(before))} % of frames reached the stack; "
             f"from {lab} on, {_pct(k2, len(after))} %")
    detail = (f"Counted over the {len(timed)} frames with a known capture time: {k1} of {len(before)} before {lab} "
              f"and {k2} of {len(after)} from then on are in {folder.kept_seq}.seq. The split is the half-hour "
              f"boundary that best separates the two shares. Siril's files record which frames were kept, not "
              f"what changed in the sky.")
    if time_unknown:
        detail += f" {time_unknown} {_plural(time_unknown, 'frame has', 'frames have')} no capture time and are not counted."
    if altitude is not None:
        cause = _altitude_cause(before, after, k1 / len(before) <= SPLIT_LOW, altitude, tz)
        if cause:
            detail += f" {cause}"
    return Finding("time_split", title, detail, "measured", True)


def night_report(folder: FolderResult, exptime_s: float, tz: str | None, bin_minutes: int = 30, *,
                 altitude: AltitudeFn | None = None) -> Report:
    """Totals, medians, time bins and findings for one night.

    ``exptime_s`` is the fallback (the capture set's modal exposure) for frames without a known one.
    ``altitude`` maps UTC ISO strings to the target's altitude in degrees (the route closes it over the
    site and target; neither is seen here). Without it no cause is ever offered.
    """
    frames = folder.frames
    aligned = [f for f in frames if f.aligned]
    kept_known = bool(frames) and all(f.kept is not None for f in frames)
    kept = [f for f in frames if f.kept] if kept_known else None

    def secs(fs: list[FrameStat]) -> float:
        return float(sum(f.exptime_s if f.exptime_s is not None else exptime_s for f in fs))

    totals = {"captured": len(frames), "aligned": len(aligned), "kept": len(kept) if kept is not None else None,
              "captured_s": secs(frames), "aligned_s": secs(aligned),
              "kept_s": secs(kept) if kept is not None else None,
              "matched": folder.matched, "unmatched": len(frames) - folder.matched}

    def med(attr: str) -> float | None:
        vals = [getattr(f, attr) for f in aligned]
        return float(statistics.median(vals)) if vals else None

    medians = {k: med(k) for k in ("stars", "fwhm", "wfwhm", "roundness")}
    stars = [f.stars for f in aligned]
    ranges = {"stars": [min(stars), max(stars)] if stars else None}

    timed = sorted(((_ts(f.utc), f) for f in frames if f.utc), key=lambda p: p[0])
    time_unknown = len(frames) - len(timed)
    bins = _bins(timed, tz, bin_minutes, kept_known)

    findings: list[Finding] = []
    unmatched = totals["unmatched"]
    if unmatched > 0:
        verb = _plural(unmatched, "doesn't", "don't")
        findings.append(Finding(
            "unmatched",
            f"{unmatched} of this folder's {len(frames)} frames {verb} match this night's imported frames",
            f"{_plural(unmatched, 'It is', 'They are')} counted in the totals but not in the time chart. "
            f"{_plural(unmatched, 'It may be a frame', 'They may be frames')} of this night that "
            f"{_plural(unmatched, 'was', 'were')} never imported, or from another night; the files cannot tell which.",
            "measured", False))
    n_un = len(frames) - len(aligned)
    if n_un:
        findings.append(Finding(
            "not_aligned", f"{n_un} {_plural(n_un, 'frame', 'frames')} couldn't be aligned",
            f"Siril's registration left {_plural(n_un, 'it', 'them')} without alignment data in "
            f"{folder.registration_seq}.seq, so {_plural(n_un, 'it', 'they')} cannot go into the stack. "
            "The files do not say why.", "measured", False))

    if kept is not None:
        dropped = [f for f in aligned if not f.kept]
        if dropped and kept:
            hi_d = max(f.roundness for f in dropped)
            lo_k = min(f.roundness for f in kept)
            if hi_d < lo_k:
                v = separating_cut(hi_d, lo_k)
                nd = len(dropped)
                title = (f"The {nd} aligned frames left out of the stack all had roundness below {v:g}" if nd != 1
                         else f"The 1 aligned frame left out of the stack had roundness below {v:g}")
                findings.append(Finding(
                    "round_cut", title,
                    f"Every kept frame had roundness of at least {lo_k:g} and every aligned frame left out at most "
                    f"{hi_d:g}, so the selection matches a roundness cut. Roundness is Siril's measure of how round "
                    "the stars are (1 is perfectly round). This describes what the files show, not the setting "
                    "that produced it.", "measured", False, value=v))

        split = _time_split(timed, bins, folder, tz, time_unknown, altitude)
        if split:
            findings.append(split)

    if medians["stars"] is not None and medians["stars"] < LOW_STARS:
        findings.append(Finding(
            "low_stars", f"Median of {medians['stars']:g} stars detected per aligned frame",
            f"Siril detected between {ranges['stars'][0]} and {ranges['stars'][1]} stars per aligned frame. The "
            f"coach treats a median under {LOW_STARS} as few (a rule of thumb, not a Siril limit): alignment has "
            "less to match, so the align step suggests two-pass registration.", "measured", True))

    if folder.calibration_dirs:
        findings.append(Finding(
            "calibration", f"Calibration folders found: {', '.join(folder.calibration_dirs)}",
            "The coach doesn't use dark, flat or bias frames yet: its scripts only debayer the light frames. Using "
            "them would add steps that build master frames and pass them to Siril's calibrate command (-dark=, "
            "-flat=, -bias=) before alignment.", "measured", False))

    return Report(totals=totals, medians=medians, ranges=ranges, bins=bins, findings=findings,
                  time_unknown=time_unknown, timezone=tz)
