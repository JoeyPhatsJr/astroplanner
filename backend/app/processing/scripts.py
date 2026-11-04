"""The two Siril 1.4.5 scripts the coach hands out (syntax verified by probe, spec section 2a).

* ``prepare_script``: convert -> debayer -> register (two-pass) every frame. It never filters, so the coach can
  read every frame's measurements before the user chooses which frames to keep.
* ``stack_script``: apply the chosen frame selection with ``seqapplyreg`` and stack the result.

Both assume Siril's working folder is the night folder (the one holding the lights folder) and write only into
``COACH_DIR`` beside it, never into the lights folder or an existing ``process/`` run. Names are relative; no
absolute or home paths. ``requires`` is the first line because without it Siril 1.4.5 runs nothing and still
reports success. Every other command line is preceded by a ``# `` comment giving the reason in our own words
(Siril's documentation is linked from the coach, not copied).
"""

from __future__ import annotations

import math
import textwrap

from .names import is_plain_folder_name
from .rules import MIN_FRAMES_FOR_REJECTION, REJECTION, Facts, stack_rejection
from .selection import SelectionOption

__all__ = ["COACH_DIR", "SCRIPT_NAMES", "SIRIL_REQUIRES", "counts_note", "disk_estimate_bytes", "format_duration",
           "frame_bytes", "prepare_script", "stack_script"]

COACH_DIR = "process-coach"
SIRIL_REQUIRES = "1.4.5"
SCRIPT_NAMES = {"prepare": "astroplanner-prepare.ssf", "stack": "astroplanner-stack.ssf"}

# Seestar S30 frames are 1080 x 1920 (NAXIS1 x NAXIS2 in the FITS headers).
S30_WIDTH, S30_HEIGHT = 1080, 1920
FITS_HEADER_BYTES = 2880  # one FITS header block


def frame_bytes(width: int = S30_WIDTH, height: int = S30_HEIGHT) -> int:
    """One debayered frame as Siril writes it: 3 layers of 32-bit float plus a header block (probe, spec 2a)."""
    return width * height * 3 * 4 + FITS_HEADER_BYTES


def disk_estimate_bytes(frame_count: int, width: int = S30_WIDTH, height: int = S30_HEIGHT) -> int:
    """Disk written for ``frame_count`` debayered (``pp_``) or aligned (``r_``) frames. ``convert``'s links to the
    FITS files are about 140 bytes each and are left out."""
    return frame_count * frame_bytes(width, height)


def _gb(n: int) -> str:
    return f"{n / 1e9:.1f} GB"


def format_duration(seconds: float) -> str:
    """Integration time the way AstroLog shows it (``formatIntegration`` in the frontend): floored, never rounded
    up, as "2 h 21 m", "3 m 20 s" or "45 s"."""
    whole = max(0, math.floor(seconds))
    if whole < 3600:
        m, s = divmod(whole, 60)
        if m == 0:
            return f"{s} s"
        return f"{m} m {s} s" if s else f"{m} m"
    h, m = divmod(whole // 60, 60)
    return f"{h} h {m} m"


def counts_note(run_dir: str | None) -> str | None:
    """Said wherever frame counts meet script 2, when the counts were read from a folder other than ``COACH_DIR``:
    script 2 always works on ``COACH_DIR``'s own registration, which can align a different set of frames."""
    if not run_dir or run_dir == COACH_DIR or not is_plain_folder_name(run_dir):
        return None  # an unsafe name is treated as unknown: never written into a script comment
    return (f"These counts are from {run_dir}/. Script 2 applies the same filter to {COACH_DIR}/, whose alignment may "
            f"differ; choose the night folder again after script 1 and pick {COACH_DIR} to see its own counts.")


def _lights_arg(name: str) -> str:
    """The lights folder as a ``cd`` argument: one plain folder name inside the night folder."""
    if not is_plain_folder_name(name):
        raise ValueError(f"The lights folder must be a single folder name inside the night folder, not {name!r}.")
    return f'"{name}"' if " " in name else name


def _header(n: int, title: str, purpose: str) -> list[str]:
    return [
        f"requires {SIRIL_REQUIRES}",
        f"# The line above stops Siril unless it is version {SIRIL_REQUIRES} or newer; without it Siril skips every line.",
        f"# AstroPlanner Processing Coach, script {n} of 2 ({title}): {purpose}",
    ]


def _run_lines(file: str, after_first: bool, lights_dir: str) -> list[str]:
    # Probe (siril-cli 1.4.5): a bare file name after -s is looked up in the -d folder, not the shell's
    # current folder ("File [...] does not exist (from CWD, use absolute path?)"), so the script's full path is asked for.
    first = ("# Run it after script 1, with the same night folder as Siril's working folder and this file's"
             if after_first else
             f"# How to run: make the night folder (the one that holds {lights_dir}/) Siril's working folder and")
    return [
        first,
        "# full path after -s, e.g." if after_first else "# give this file's full path after -s, e.g.",
        f'#   siril-cli -d "<night folder>" -s "<folder you saved it in>/{file}"',
        "# A bare file name after -s is looked up in the night folder, not in the terminal's current folder.",
        "# In Siril itself: set the working folder to the night folder, add the folder holding this file",
        "# to the script folders in Preferences (Scripts), then choose the script from the Scripts menu.",
    ]


def prepare_script(facts: Facts) -> str:
    lights = _lights_arg(facts.lights_dir)
    n = facts.frame_count
    pattern = (f"header ({facts.bayer_pattern} on this night)" if facts.bayer_pattern else
               "header (Siril's log says which pattern it found)")
    lines = [
        *_header(1, "prepare", f"convert, debayer and align all {n} frames."),
        "# It keeps every frame. Choose which frames to stack in the coach afterwards, then run script 2.",
        *_run_lines(SCRIPT_NAMES["prepare"], after_first=False, lights_dir=facts.lights_dir),
        f"# Disk: about {_gb(disk_estimate_bytes(n))} in {COACH_DIR}/ next to {facts.lights_dir}/ for the {n} frames. "
        "Script 2 adds up to",
        f"# about {_gb(disk_estimate_bytes(n))} more (an aligned copy of each frame you keep, at most all {n}), so allow "
        "about",
        f"# {_gb(2 * disk_estimate_bytes(n))} in all. Nothing is written into {facts.lights_dir}/ or any other folder.",
        "# Move into the folder with the light frames so the next line can find them. Siril converts every",
        "# image it finds there, so it should hold only this night's light frames.",
        f"cd {lights}",
        f"# Gather the frames into one numbered sequence in {COACH_DIR}/ (Siril links to the FITS files",
        "# rather than copying them) and record which file became which number in light_conversion.txt.",
        f"convert light -out=../{COACH_DIR}",
        f"# Work inside {COACH_DIR}/ from here on, so everything below is written there.",
        f"cd ../{COACH_DIR}",
        "# Rebuild full colour from the sensor's colour mosaic using the Bayer pattern in each frame's",
        f"# {pattern}. No darks or flats are used. This writes the pp_light_ frames.",
        "calibrate light -debayer",
        "# Find the stars in every frame and work out how each one lines up with a reference frame picked",
        "# from the whole night. This stores the measurements in pp_light_.seq and writes no new images.",
        "register pp_light -2pass",
        f"# Release the sequence. Next, choose the night folder in the coach so it can read {COACH_DIR}/.",
        "close",
    ]
    return "\n".join(lines) + "\n"


def _filter(option: SelectionOption) -> tuple[str, str, list[str]]:
    """(``seqapplyreg`` options, what the choice is, why-lines) for one selection option.

    Percentage options pass Siril's ``p%`` form so Siril applies its own rule (``option.value`` is only the
    threshold it resolves to, for display); ``previous`` passes its literal roundness limit."""
    if option.filter == "none":
        return "", "every frame Siril aligned, no filter", ["# not align are always left out. No other filter is applied."]
    if option.filter == "round" and option.percent is not None:
        p = option.percent
        return f" -filter-round={p}%", f"Siril's {p} % roundness filter", [
            "# not align are always left out. Siril counts this percentage over all the frames, including any",
            f"# it could not align, so it can keep more than {p} % of the aligned ones."]
    if option.filter == "round" and option.value is not None:
        v = repr(float(option.value))  # shortest text that reads back as exactly this number
        return f" -filter-round={v}", f"roundness of at least {v}", [
            f"# not align are always left out. Only frames whose roundness is at least {v} pass."]
    if option.filter == "wfwhm" and option.percent is not None:
        p = option.percent
        return f" -filter-wfwhm={p}%", f"Siril's {p} % weighted-FWHM filter", [
            "# not align are always left out. Siril ranks the aligned frames by weighted star size (FWHM)",
            f"# and keeps those up to its {p} % limit, so smaller stars pass."]
    raise ValueError(f"Selection option {option.id!r} has no filter the stack script can write.")


def _stack_lines(kept: int) -> list[str]:
    """The ``stack`` line and its reason. Rejection follows ``rules.stack_rejection``, the same rule the stack
    step's advice states, applied to the chosen option's kept count."""
    rej = stack_rejection(kept)
    common = ["# Additive normalisation with scaling evens out changes in sky level; the result is scaled to",
              "# 0 to 1 and the three colour channels are balanced."]
    if rej == REJECTION:
        why = [f"# Average the kept frames into result_coach.fit. With {kept} frames (the coach's rule of thumb",
               f"# for sigma clipping is {MIN_FRAMES_FOR_REJECTION} or more), winsorized clipping at 3 and 3 drops "
               "values that",
               "# show up in only a few frames, such as satellite trails and hot pixels."]
    else:
        why = [f"# Average the kept frames into result_coach.fit without pixel rejection: {kept} frames is under",
               f"# the coach's rule-of-thumb {MIN_FRAMES_FOR_REJECTION} for sigma clipping, so satellite trails "
               "and hot pixels can remain."]
    return [*why, *common, f"stack r_pp_light {rej} -norm=addscale -output_norm -rgb_equal -out=result_coach"]


def stack_script(option: SelectionOption, facts: Facts) -> str:
    opts, what, why = _filter(option)
    k = option.kept
    _lights_arg(facts.lights_dir)  # validates lights_dir, which the run lines name in a comment
    counts_dir = facts.counts_dir if is_plain_folder_name(facts.counts_dir) else None  # else unknown: not written
    src = counts_dir or COACH_DIR
    note = counts_note(counts_dir)
    lines = [
        *_header(2, "stack", "apply your frame choice and stack."),
        *_run_lines(SCRIPT_NAMES["stack"], after_first=True, lights_dir=facts.lights_dir),
        f"# Your choice: {what}.",
        f"# Counted in {src}/, the folder the coach read, it would keep {k} frames ({format_duration(option.seconds)}).",
        *(["# " + ln for ln in textwrap.wrap(note, 104)] if note else []),
        f"# It writes only into {COACH_DIR}/: about {_gb(disk_estimate_bytes(k))} more for the {k} aligned frames, "
        "plus the stack.",
        f"# Move into {COACH_DIR}/, where script 1 left the aligned sequence.",
        f"cd {COACH_DIR}",
        "# Write an aligned copy (r_pp_light_) of each frame that passes your choice; frames Siril could",
        *why,
        f"seqapplyreg pp_light{opts}",
        *_stack_lines(k),
        f"# Release the sequence. result_coach.fit in {COACH_DIR}/ is your stack for the next steps.",
        "close",
    ]
    return "\n".join(lines) + "\n"
