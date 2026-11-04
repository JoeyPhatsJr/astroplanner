"""Advice rules. Every piece of advice carries where it came from; there is no score and no winner.

basis:
  measured          - derived from the user's own files (headers, Siril output)
  siril-docs        - what Siril's documentation says; requires source_url (https)
  tutorial-default  - a common starting value from tutorials, not derived from this night
  taste             - a stylistic choice
`heuristic` is True when the advice is a rule of thumb rather than a derived fact.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Callable

from .models import Basis, StepId
from .report import LOW_STARS

if TYPE_CHECKING:
    from .report import Report

__all__ = ["Advice", "Basis", "Facts", "RULES", "Rule", "advice_for"]

SIRIL_COMMANDS_URL = "https://siril.readthedocs.io/en/stable/Commands.html"


@dataclass(frozen=True)
class Advice:
    rule_id: str
    setting: str
    why: str
    basis: Basis
    heuristic: bool
    source_url: str | None = None


@dataclass(frozen=True)
class Facts:
    bayer_pattern: str | None  # the one pattern shared by every frame's header, else None
    frame_count: int
    exptime_s: float | None
    report: Report | None = None  # the night report, once a Siril folder has been read
    # Filled by later tasks; typed loosely until their dataclasses exist.
    siril_stack: Any | None = None  # StackMeasurement
    seestar_stack: Any | None = None  # StackMeasurement
    lights_dir: str = "lights"  # the night-folder subfolder holding the light FITS frames (used by scripts.py)
    selection_kept: int | None = None  # frames the saved frame choice keeps; what the stack script will stack


@dataclass(frozen=True)
class Rule:
    id: str
    step: StepId
    basis: Basis
    heuristic: bool
    source_url: str | None
    applies: Callable[[Facts], bool]
    advise: Callable[[Facts], Advice]


def _debayer_measured(f: Facts) -> Advice:
    return Advice(
        rule_id="convert.debayer",
        setting=f"Debayer with pattern {f.bayer_pattern} (from your frame headers)",
        why=f"Every one of your {f.frame_count} frames reports the same Bayer pattern in its header, "
            "so the colour reconstruction can use it directly.",
        basis="measured", heuristic=False)


def _debayer_docs(f: Facts) -> Advice:
    return Advice(
        rule_id="convert.debayer",
        setting="Siril reads the pattern from each frame's `BAYERPAT` header",
        why="The frame headers do not agree on, or do not carry, a usable Bayer pattern, so the coach cannot "
            "state one; Siril's debayering reads the header itself and tells you what it found in its log.",
        basis="siril-docs", heuristic=False, source_url=SIRIL_COMMANDS_URL)


# Heuristic: the kept-frame count from which the coach suggests sigma-clipping rejection (docs/PROCESSING.md).
MIN_FRAMES_FOR_REJECTION = 30
REJECTION = "rej w 3 3"  # winsorized sigma clipping, low and high sigma 3
NO_REJECTION = "rej n"  # plain average, no pixel rejection (Siril's letter n; the sigmas are then omitted)


def stack_rejection(frames: int) -> str:
    """The rejection the stack script writes for ``frames`` stacked frames; the stack advice states the same."""
    return REJECTION if frames >= MIN_FRAMES_FOR_REJECTION else NO_REJECTION


def _median_stars(f: Facts) -> float | None:
    return f.report.medians.get("stars") if f.report is not None else None


def _stack_count(f: Facts) -> tuple[int, str] | None:
    """Frames that will be stacked: the saved frame choice's count (what the stack script uses); before a choice,
    the kept count of the folder read, else its aligned count (an upper bound)."""
    if f.selection_kept is not None:
        return f.selection_kept, "chosen"
    if f.report is None:
        return None
    t = f.report.totals
    return (t["kept"], "kept") if t.get("kept") is not None else (t["aligned"], "aligned")


def _two_pass(f: Facts) -> Advice:
    m = _median_stars(f)
    return Advice(
        rule_id="align.two_pass",
        setting="The coach's script registers in two passes (register ... -2pass)",
        why="The coach's script always registers in two passes: the first picks a reference frame from the whole "
            "sequence, the second aligns every frame to it. It matters on this night because Siril found a median "
            f"of {m:g} stars per aligned frame, under the coach's rule-of-thumb level of {LOW_STARS}, so each frame "
            "has few stars to match and a well-chosen reference helps. Nothing to change: this explains what the "
            "script already does.",
        basis="measured", heuristic=True)


def _rejection(f: Facts) -> Advice:
    n, what = _stack_count(f)
    return Advice(
        rule_id="stack.rejection",
        setting=f"Winsorized sigma clipping, 3 and 3 (stack ... {REJECTION})",
        why=f"With {n} {what} frames there are enough values per pixel for rejection to drop outliers such as "
            "satellite trails and hot pixels. Siril's stack command offers winsorized sigma clipping (letter w) "
            "with a low and a high sigma limit; 3 and 3 are common starting limits, not tuned to this night.",
        basis="siril-docs", heuristic=True, source_url=SIRIL_COMMANDS_URL)


def _no_rejection(f: Facts) -> Advice:
    n, what = _stack_count(f)
    return Advice(
        rule_id="stack.rejection",
        setting=f"No pixel rejection, a plain average (stack ... {NO_REJECTION})",
        why=f"With {n} {what} frames each pixel has few values to compare, which is under the coach's rule-of-thumb "
            f"{MIN_FRAMES_FOR_REJECTION} frames for sigma clipping, so the coach's stack script averages them without "
            "rejection (Siril's letter n). Satellite trails and hot pixels can stay in the result; with "
            f"{MIN_FRAMES_FOR_REJECTION} or more frames the script uses winsorized clipping at 3 and 3 instead.",
        basis="siril-docs", heuristic=True, source_url=SIRIL_COMMANDS_URL)


RULES: tuple[Rule, ...] = (
    Rule("convert.debayer", "convert", "measured", False, None,
         lambda f: f.bayer_pattern is not None, _debayer_measured),
    Rule("convert.debayer", "convert", "siril-docs", False, SIRIL_COMMANDS_URL,
         lambda f: f.bayer_pattern is None, _debayer_docs),
    Rule("align.two_pass", "align", "measured", True, None,
         lambda f: (m := _median_stars(f)) is not None and m < LOW_STARS, _two_pass),
    Rule("stack.rejection", "stack", "siril-docs", True, SIRIL_COMMANDS_URL,
         lambda f: (c := _stack_count(f)) is not None and stack_rejection(c[0]) == REJECTION, _rejection),
    Rule("stack.rejection", "stack", "siril-docs", True, SIRIL_COMMANDS_URL,
         lambda f: (c := _stack_count(f)) is not None and stack_rejection(c[0]) == NO_REJECTION, _no_rejection),
)


def advice_for(step: StepId, facts: Facts) -> list[Advice]:
    return [r.advise(facts) for r in RULES if r.step == step and r.applies(facts)]
