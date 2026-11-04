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
from typing import TYPE_CHECKING, Callable

from .models import Basis, StepId
from .report import LOW_STARS

if TYPE_CHECKING:
    from .measure import StackMeasurement
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
    siril_stack: StackMeasurement | None = None  # the developer's Siril stack, measured (measure.py)
    seestar_stack: StackMeasurement | None = None  # the Seestar's own stack, measured; used by the compare step
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


# ---- steps 6-9 from the Siril stack's measurement (docs/PROCESSING.md, "Advice from a measured stack") ----------
# Heuristic: after a plane is removed, tile-median structure above this fraction of the brightness range is
# more than a plane explains, so the coach suggests a second-degree background model.
RESIDUAL_FOR_DEGREE2 = 0.01
# Heuristic: the strongest background channel, relative to the mean of the three, above which the background is
# called colour-cast (5 % above neutral).
COLOUR_CAST_RATIO = 1.05
PLATE_SOLVE_NOTE = ("Both colour-calibration tools (pcc, spcc) need the image plate-solved first, which the "
                    "Photometric Color Calibration window can do for you.")
_CHANNELS = ("red", "green", "blue")


def _pct(x: float) -> str:
    return f"{100.0 * x:.1f} %"


def _degree(m: StackMeasurement) -> int:
    return 1 if m.gradient_residual_frac < RESIDUAL_FOR_DEGREE2 else 2


def _background_measured(f: Facts) -> Advice:
    m = f.siril_stack
    d = _degree(m)
    lead = (f"Your Siril stack's background changes by {_pct(m.gradient_frac)} of the image's brightness range "
            f"between opposite corners (the best flat plane through it). After that plane is taken out, "
            f"{_pct(m.gradient_residual_frac)} of the brightness range remains as uneven structure; large nebula "
            "counts as structure here and the coach cannot tell nebula from sky gradient in that number")
    if d == 1:
        tail = (f". That is under the coach's rule-of-thumb {_pct(RESIDUAL_FOR_DEGREE2)}, so a first-degree model (a "
                "tilted plane) is enough to start with.")
    else:
        tail = (f". That is at or over the coach's rule-of-thumb {_pct(RESIDUAL_FOR_DEGREE2)}, so a second-degree "
                "(curved) model may follow the background better than a plane. Check it: if Siril's background "
                "model shows the nebula's shape, or the nebula looks dimmer after extraction, undo and use "
                "degree 1.")
    return Advice(
        rule_id="background.degree",
        setting=(f"Background extraction, polynomial degree {d} (subsky {d})" if d == 1 else
                 "Background extraction, polynomial degree 2 (subsky 2); degree 1 if the model follows the nebula"),
        why=lead + tail,
        basis="measured", heuristic=True)


def _background_default(f: Facts) -> Advice:
    return Advice(
        rule_id="background.degree",
        setting="Background extraction, polynomial degree 1 (subsky 1)",
        why="A first-degree model (a tilted plane) is the usual first try in tutorials. Nothing has been measured "
            "on your stack, so this is a starting value, not derived from this night.",
        basis="tutorial-default", heuristic=True)


def _cast(m: StackMeasurement) -> tuple[str, float] | None:
    if m.bg_rgb_ratio is None or not max(m.bg_rgb_ratio) > COLOUR_CAST_RATIO:
        return None
    i = max(range(3), key=lambda k: m.bg_rgb_ratio[k])
    return _CHANNELS[i], m.bg_rgb_ratio[i]


def _ratios(m: StackMeasurement) -> str:
    r = m.bg_rgb_ratio
    return f"{r[0]:.3f} : {r[1]:.3f} : {r[2]:.3f}"


def _colour_cast(f: Facts) -> Advice:
    m = f.siril_stack
    name, v = _cast(m)
    return Advice(
        rule_id="colour.cast",
        setting=f"Run colour calibration; the background leans {name}",
        why=f"The sky background of your Siril stack measures red : green : blue = {_ratios(m)} against their "
            f"mean; {name} is {100.0 * (v - 1):.1f} % above it, over the coach's rule-of-thumb "
            f"{100.0 * (COLOUR_CAST_RATIO - 1):.0f} %. Colour calibration (pcc or spcc) matches star colours to a "
            f"catalogue and corrects a cast like this. {PLATE_SOLVE_NOTE}",
        basis="measured", heuristic=True)


EQUALIZED_CAVEAT = ("If the stack was made with the coach's script or with Siril's 'equalize RGB' (-rgb_equal), "
                    "the background channels are levelled during stacking, so a neutral reading is expected and "
                    "says little about the sky's colour; colour calibration still sets the star colours.")
EQUALIZED_STATED = ("This stack's header says Siril equalized RGB while stacking, which levels the background "
                    "channels, so a neutral reading is expected and says little about the sky's colour; "
                    "colour calibration still sets the star colours.")


def _colour_neutral(f: Facts) -> Advice:
    m = f.siril_stack
    caveat = EQUALIZED_STATED if m.rgb_equalized else EQUALIZED_CAVEAT
    return Advice(
        rule_id="colour.cast",
        setting="No strong colour cast measured; colour calibration is still worth running",
        why=f"The background of your Siril stack measures red : green : blue = {_ratios(m)} against their "
            f"mean, no channel more than {100.0 * (COLOUR_CAST_RATIO - 1):.0f} % above it (the coach's "
            f"rule-of-thumb limit). {caveat} Colour calibration (pcc or spcc) matches star colours to a "
            f"catalogue. {PLATE_SOLVE_NOTE}",
        basis="measured", heuristic=True)


def _colour_default(f: Facts) -> Advice:
    note = ""
    if f.siril_stack is not None:
        note = "Your Siril stack has a single channel, so its background colour could not be measured. "
    return Advice(
        rule_id="colour.cast",
        setting="Run colour calibration (pcc or spcc) after plate solving",
        why=f"{note}Photometric colour calibration, which matches star colours to a catalogue, is the usual "
            f"first colour step in tutorials; this is a starting choice, not derived from this night. {PLATE_SOLVE_NOTE}",
        basis="tutorial-default", heuristic=True)


def _stretch(f: Facts) -> Advice:
    m = f.siril_stack
    extra = ""
    if m is not None:
        extra = (f" The background noise of your Siril stack measures {_pct(m.noise_frac)} of the image's "
                 "brightness range; stretching lifts noise along with signal, so judge the result on the preview.")
    return Advice(
        rule_id="stretch.start",
        setting="Start from the auto-stretch (autostretch), then adjust by eye",
        why="Siril's auto-stretch gives a sensible first view of linear data; how bright and contrasty to go "
            f"is a matter of taste, so the coach gives no number for it.{extra}",
        basis="taste", heuristic=False)


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
    Rule("background.degree", "background", "measured", True, None, lambda f: f.siril_stack is not None,
         _background_measured),
    Rule("background.degree", "background", "tutorial-default", True, None, lambda f: f.siril_stack is None,
         _background_default),
    Rule("colour.cast", "colour", "measured", True, None,
         lambda f: f.siril_stack is not None and _cast(f.siril_stack) is not None, _colour_cast),
    Rule("colour.cast", "colour", "measured", True, None,
         lambda f: f.siril_stack is not None and f.siril_stack.bg_rgb_ratio is not None
         and _cast(f.siril_stack) is None, _colour_neutral),
    Rule("colour.cast", "colour", "tutorial-default", True, None,
         lambda f: f.siril_stack is None or f.siril_stack.bg_rgb_ratio is None, _colour_default),
    Rule("stretch.start", "stretch", "taste", False, None, lambda f: True, _stretch),
)


def advice_for(step: StepId, facts: Facts) -> list[Advice]:
    return [r.advise(facts) for r in RULES if r.step == step and r.applies(facts)]
