"""The ten coach steps: plain-language copy (our own words) plus the advice the rules give for each."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from .models import STEP_ORDER, STEP_TITLES, StepId
from .rules import Advice, Facts, advice_for
from .scripts import SCRIPT_NAMES

__all__ = ["STEP_ORDER", "StepId", "StepView", "build_steps"]

# (does, gui, command, expect). `command` is the terminal line that runs the coach's script for the step (scripts.py;
# the UI offers the script itself as a download); `expect` is only written where the Task 1 probe observed the result.
# -d makes the night folder Siril's working folder; a bare name after -s is looked up there (probe), so a full path.
_RUN = 'siril-cli -d "<night folder>" -s "<folder you saved it in>/{}"'
_COPY: dict[str, tuple[str, str, str | None, str | None]] = {
    "report": (
        "Reads your light frames once and writes down facts about the night (how many frames, how sharp and round "
        "the stars are, where the background sits) so the later choices can be based on your data.",
        "Nothing to do in Siril's windows for this step. Choose the night folder (the one containing lights/) with "
        "a Siril run inside, whether it is one you already made or one from the coach's first script, and the "
        "coach reads it. Choose it again any time to re-read it.",
        None, None),
    "convert": (
        "Gathers your light frames into one numbered sequence Siril can work through, and turns the single-channel "
        "colour-mosaic data into a full colour image (debayering).",
        "In the Conversion tab, add your light frames, tick debayering, name the sequence and press Convert.",
        _RUN.format(SCRIPT_NAMES["prepare"]),
        "A working folder holding one numbered file per light frame, plus a sequence file for them, and a text "
        "file listing which source file became which numbered frame."),
    "align": (
        "Finds the stars in every frame and works out how much each frame has to shift so the stars line up. "
        "Frames where it cannot find enough stars are left out.",
        "In the Registration tab choose the global star alignment method, tick the two-pass option and press "
        "Go register.",
        None,
        "A log line per frame with star sharpness and roundness, ending in a count of how many frames were "
        "registered and how many failed."),
    "select": (
        "Lets you drop the weakest frames (smeared stars, passing cloud) before stacking. More frames means less "
        "noise but a few bad ones can soften the result.",
        "In the Plot tab, tick the measurement you want to filter on and untick frames you do not want, or use the "
        "filter options when you stack.",
        None, None),
    "stack": (
        "Averages the aligned frames into one image. Rejection removes things that appear in only a few frames, "
        "like satellite trails and hot pixels.",
        "In the Stacking tab choose the aligned sequence, pick a rejection method, set normalisation and press "
        "Start stacking.",
        _RUN.format(SCRIPT_NAMES["stack"]),
        "A single stacked FITS file whose header records how many frames went into it and the total exposure "
        "time."),
    "background": (
        "Subtracts the smooth glow across the image (light pollution, vignetting) so the faint detail is not "
        "sitting on a tilted floor.",
        "Open the stacked image, use the background extraction tool from the Image Processing menu, place "
        "samples on empty sky and apply.",
        None, None),
    "colour": (
        "Fixes the colour balance, ideally by matching star colours against a catalogue. That needs the image to "
        "be plate-solved first.",
        "Use the photometric colour calibration tool from the Image Processing menu; it solves the image for you "
        "if needed.",
        None, None),
    "stretch": (
        "Brightens the faint end of the data, which starts out very dark, so nebulae and galaxies become visible "
        "on a screen.",
        "Use the histogram or auto-stretch tools from the Image Processing menu and watch the preview.",
        None, None),
    "finish": (
        "Final touches: tame the stars, tidy colour noise and save the result in a format you can share.",
        "Use the star and noise tools from the Image Processing menu, then save the image as FITS or TIFF.",
        None, None),
    "compare": (
        "Puts your Siril stack next to the Seestar's own stack for the same night, with measured numbers rather "
        "than a verdict.",
        "Nothing to do in Siril: you tell the coach which two files to compare.",
        None, None),
}


@dataclass
class StepView:
    id: StepId
    n: int
    title: str
    does: str
    advice: list[Advice] = field(default_factory=list)
    gui: str = ""
    command: str | None = None
    expect: str | None = None
    state: Literal["todo", "done"] = "todo"
    blocked: str | None = None
    prompt: str | None = None  # an invitation to add a file for measured advice; the step still works without it


def _blocked(step: str, facts: Facts) -> str | None:
    if step == "report" and facts.report is None:
        return ("No night report yet. Choose a night folder that already holds a Siril run, or run the coach's first "
                "script and then choose the folder it wrote.")
    if step == "select" and facts.report is None:
        return "Needs the night report from the first script, which measures each frame."
    return None


STACK_PROMPT = "Add your Siril stack to get advice for this night"
_NEEDS_SIRIL_STACK = ("background", "colour", "stretch")


def _prompt(step: str, facts: Facts) -> str | None:
    return STACK_PROMPT if step in _NEEDS_SIRIL_STACK and facts.siril_stack is None else None


def build_steps(facts: Facts, step_states: dict[str, str]) -> list[StepView]:
    out: list[StepView] = []
    for n, sid in enumerate(STEP_ORDER, start=1):
        does, gui, command, expect = _COPY[sid]
        out.append(StepView(
            id=sid, n=n, title=STEP_TITLES[sid], does=does, advice=advice_for(sid, facts), gui=gui,
            command=command, expect=expect, state="done" if step_states.get(sid) == "done" else "todo",
            blocked=_blocked(sid, facts), prompt=_prompt(sid, facts)))
    return out
