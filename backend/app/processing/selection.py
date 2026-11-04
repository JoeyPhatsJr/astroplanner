"""Frame-selection options for the "Choose frames" step.

Every count and every second comes from the stored per-frame statistics (Siril's own numbers), never an
estimate. The percentage options reproduce Siril 1.4.5's ``-filter-round=p%`` / ``-filter-wfwhm=p%`` rule
(spec 2a, source ``src/core/sequence_filtering.c``), so the number shown here is the number Siril will keep:

* roundness (higher is better): the sorted list covers all N frames of the sequence with unaligned frames
  counted as zeros, threshold = sorted[floor((100 - p) * (N - 1) / 100)]; with unaligned frames present this
  keeps more than p % of the aligned ones.
* weighted FWHM (lower is better): only the n aligned frames count, threshold = sorted[floor(p * (n - 1) / 100)].

Ties at the threshold are kept; a frame whose value is zero never passes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Sequence

from .models import Basis
from .report import FrameStat

KEEP_PERCENT = 80  # heuristic: a rule of thumb for "keep most, drop the worst fifth"; see docs/PROCESSING.md

FilterKind = Literal["none", "round", "wfwhm"]


@dataclass(frozen=True)
class SelectionOption:
    id: str
    label: str
    filter: FilterKind
    value: float | None  # roundness limit (``previous``) or the threshold a percentage resolved to (informational)
    percent: int | None  # set for Siril's ``p%`` filters; the stack script uses it, not ``value``
    kept: int
    seconds: float
    basis: Basis
    heuristic: bool
    note: str


@dataclass(frozen=True)
class LastChoice:
    night_date: str
    target_name: str
    option_label: str
    kept: int


def _roundness(f: FrameStat) -> float:
    return f.roundness or 0.0


def _wfwhm(f: FrameStat) -> float:
    return f.wfwhm or 0.0


def round_threshold(frames: Sequence[FrameStat], percent: int) -> float:
    values = sorted(_roundness(f) if f.aligned else 0.0 for f in frames)
    return values[((100 - percent) * (len(values) - 1)) // 100]


def wfwhm_threshold(aligned: Sequence[FrameStat], percent: int) -> float:
    values = sorted(_wfwhm(f) for f in aligned)
    return values[(percent * (len(values) - 1)) // 100]


def selection_options(
    frames: Sequence[FrameStat],
    exptime_s: float,
    previous_round_cut: float | None,
    last_time: LastChoice | None,  # shown by the caller as a note; it never changes the options or picks one
) -> list[SelectionOption]:
    """The options for this night, in display order, without duplicates (same filter and same kept count)."""
    aligned = [f for f in frames if f.aligned]
    if not aligned:
        return []
    big_n, n = len(frames), len(aligned)

    def seconds(fs: Sequence[FrameStat]) -> float:
        return float(sum(f.exptime_s if f.exptime_s is not None else exptime_s for f in fs))

    over_all = f"Siril's percentage, counted over all {big_n} frames, so it keeps more than {{p}} % of the {n} aligned ones."
    opts: list[SelectionOption] = []

    kept = aligned
    opts.append(SelectionOption(
        "all", "Keep every aligned frame", "none", None, None, len(kept), seconds(kept), "measured", False,
        f"All {n} frames Siril aligned: the most signal, with the softest and least round stars included."))

    if previous_round_cut is not None:
        kept = [f for f in aligned if _roundness(f) > 0 and _roundness(f) >= previous_round_cut]
        opts.append(SelectionOption(
            "previous", f"Same as your last run: roundness ≥ {previous_round_cut:g}", "round",
            previous_round_cut, None, len(kept), seconds(kept), "measured", False,
            "The roundness limit that separates the frames kept from those dropped in the Siril folder you read."))

    p = KEEP_PERCENT
    thr = round_threshold(frames, p)
    kept = [f for f in aligned if _roundness(f) > 0 and _roundness(f) >= thr]
    note = over_all.format(p=p) if big_n != n else f"Siril's {p} % roundness filter over the {n} aligned frames."
    opts.append(SelectionOption(
        f"round{p}", f"Roundness filter, {p} %", "round", thr, p, len(kept), seconds(kept), "measured", True,
        f"{note} Resolves to roundness ≥ {thr:g}. The {p} % is a rule of thumb, not a Siril default."))

    thr = wfwhm_threshold(aligned, p)
    kept = [f for f in aligned if _wfwhm(f) > 0 and _wfwhm(f) <= thr]
    opts.append(SelectionOption(
        f"wfwhm{p}", f"Star-size filter (weighted FWHM), {p} %", "wfwhm", thr, p, len(kept), seconds(kept),
        "measured", True,
        f"Siril's {p} % weighted-FWHM filter over the {n} aligned frames (smaller stars are better). Resolves to "
        f"weighted FWHM ≤ {thr:.2f} px. The {p} % is a rule of thumb, not a Siril default."))

    seen: set[tuple[str, int]] = set()
    out: list[SelectionOption] = []
    for o in opts:
        key = (o.filter, o.kept)
        if key not in seen:
            seen.add(key)
            out.append(o)
    return out
