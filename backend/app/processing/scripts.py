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

from .rules import Facts
from .selection import SelectionOption

__all__ = ["COACH_DIR", "SCRIPT_NAMES", "SIRIL_REQUIRES", "disk_estimate_bytes", "frame_bytes", "prepare_script",
           "stack_script"]

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


def _duration(seconds: float) -> str:
    minutes = round(seconds / 60)
    h, m = divmod(minutes, 60)
    return f"{h} h {m} min" if h else f"{m} min"


def _lights_arg(name: str) -> str:
    """The lights folder as a ``cd`` argument: one plain folder name inside the night folder."""
    bad = (not name or name != name.strip() or name in (".", "..") or any(c in name for c in "/\\~\"'\n\r\t")
           or name.startswith("-") or not name.isprintable())
    if bad:
        raise ValueError(f"The lights folder must be a single folder name inside the night folder, not {name!r}.")
    return f'"{name}"' if " " in name else name


def _header(n: int, title: str, purpose: str) -> list[str]:
    return [
        f"requires {SIRIL_REQUIRES}",
        f"# The line above stops Siril unless it is version {SIRIL_REQUIRES} or newer; without it Siril skips every line.",
        f"# AstroPlanner Processing Coach, script {n} of 2 ({title}): {purpose}",
    ]


def _run_lines(file: str, after_first: bool) -> list[str]:
    first = ("# Run it after script 1, with the same night folder as Siril's working folder, e.g." if after_first else
             "# How to run: make the night folder (the one that holds lights/) Siril's working folder, e.g.")
    return [
        first,
        f'#   siril-cli -d "<night folder>" -s {file}',
        "# or, in Siril, set the working folder to the night folder and run this file from the Scripts menu.",
    ]


def prepare_script(facts: Facts) -> str:
    lights = _lights_arg(facts.lights_dir)
    n = facts.frame_count
    pattern = (f"header ({facts.bayer_pattern} on this night)" if facts.bayer_pattern else
               "header (Siril's log says which pattern it found)")
    lines = [
        *_header(1, "prepare", f"convert, debayer and align all {n} frames."),
        "# It keeps every frame. Choose which frames to stack in the coach afterwards, then run script 2.",
        *_run_lines(SCRIPT_NAMES["prepare"], after_first=False),
        f"# It writes only into {COACH_DIR}/ next to lights/: about {_gb(disk_estimate_bytes(n))} for {n} frames.",
        "# Move into the folder with the light frames so the next line can find them.",
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


def stack_script(option: SelectionOption, facts: Facts) -> str:
    opts, what, why = _filter(option)
    k = option.kept
    lines = [
        *_header(2, "stack", "apply your frame choice and stack."),
        *_run_lines(SCRIPT_NAMES["stack"], after_first=True),
        f"# Your choice: {what}. The coach expects it to keep {k} frames ({_duration(option.seconds)}).",
        f"# It writes only into {COACH_DIR}/: about {_gb(disk_estimate_bytes(k))} more for the {k} aligned frames, "
        "plus the stack.",
        f"# Move into {COACH_DIR}/, where script 1 left the aligned sequence.",
        f"cd {COACH_DIR}",
        "# Write an aligned copy (r_pp_light_) of each frame that passes your choice; frames Siril could",
        *why,
        f"seqapplyreg pp_light{opts}",
        "# Average the kept frames into result_coach.fit. Winsorized sigma clipping (3 and 3) drops values",
        "# that show up in only a few frames, such as satellite trails and hot pixels; additive",
        "# normalisation with scaling evens out changes in sky level; the result is scaled to 0 to 1 and",
        "# the three colour channels are balanced.",
        "stack r_pp_light rej w 3 3 -norm=addscale -output_norm -rgb_equal -out=result_coach",
        f"# Release the sequence. result_coach.fit in {COACH_DIR}/ is your stack for the next steps.",
        "close",
    ]
    return "\n".join(lines) + "\n"
