# Processing Coach: methods and sources

_Skeleton created in Phase 4 Task 1 (gate G1). Later tasks add the method sections: the `.seq` reader, the night
report, selection options, the generated scripts, stack measurement and the advice rules._

AstroPlanner writes Siril scripts and reads Siril's output files. It copies no Siril source code or documentation
text (Siril is GPL-3.0; its documentation has its own licence). Facts below are recorded in our own words in
`docs/superpowers/specs/2026-11-03-processing-coach-design.md` section 2a.

## Sources

Read on 2026-11-03 for Siril 1.4.5:

- Siril command reference ("stable", headed 1.4.4; the installed 1.4.5 `help <command>` output was compared and
  gives the same syntax): <https://siril.readthedocs.io/en/stable/Commands.html>
- `.seq` read/write code and format history, tag 1.4.5:
  <https://gitlab.com/free-astro/siril/-/blob/1.4.5/src/io/seqfile.c>
- Frame filter code (literal, percent and k-sigma rules), tag 1.4.5:
  <https://gitlab.com/free-astro/siril/-/blob/1.4.5/src/core/sequence_filtering.c>
- Registration code (how unaligned frames are recorded), tag 1.4.5:
  <https://gitlab.com/free-astro/siril/-/blob/1.4.5/src/registration/global.c>
- Apply-registration code (how the `r_` sequence is written), tag 1.4.5:
  <https://gitlab.com/free-astro/siril/-/blob/1.4.5/src/registration/applyreg.c>
- Release tag listing: <https://gitlab.com/free-astro/siril/-/tree/1.4.5>
- Local probe: `siril-cli` 1.4.5 run on a synthetic 40-frame night in a scratch folder (nothing from the
  developer's real observing folders).

Python dependency:

- photutils 3.0.0 (BSD-3-Clause): <https://photutils.readthedocs.io/>. Checked by installing it and importing
  `photutils.psf.fit_fwhm` and `photutils.detection.DAOStarFinder`; the documentation pages were not read in
  this task.

## Night report rules and constants

_Added in Phase 4 Task 5 (`backend/app/processing/report.py`, `rules.py`)._ The night report reads only the text
of Siril's `.seq` files and `light_conversion.txt` from one working folder (the browser sends them; no pixels, no
absolute paths are kept: only the folder's own name, such as `process`, and light-frame basenames).

**Which files.** The registration sequence is the non-`r_` sequence that has any registration data and the most
images (for the tutorial folder: `pp_light_`). The kept sequence is `r_` + that name, if present. Kept frames are
matched to the registration sequence by `filenum`, and the five copied statistics are compared as a staleness
check (spec §2a); if they differ, which frames were kept is reported as unknown and the user is asked to re-run
the stacking script. Each frame's source basename comes from the conversion file, keyed by the number in the
destination name (`light_00007.fit` is 7).

**Times.** A frame's time is the AstroLog `date_obs_utc` (FITS `DATE-OBS`) of the imported frame with the same
basename, never the local time written in the file name. Frames with no match count as `time_unknown` and are
left out of the time bins and the split finding. Bins are floored in UTC to 30 minutes and labelled in the night
location's IANA timezone, so a DST fall-back night shows two separate `01:00` bins. Empty bins between the first
and last frame are kept so gaps show.

**Totals.** Captured, aligned and kept seconds sum each frame's own `EXPTIME` where the frame matched an imported
one, else the capture set's most common exposure. Medians and the star range are over aligned frames only.
Background values are Siril's and are labelled "Siril units, relative": ADU for 16-bit sequences, 0 to 1 for
debayered 32-bit float ones, so they are only compared within one sequence.

**Findings** (fixed rules; every finding has a `basis` and a `heuristic` flag; none is a score):

| id | when | basis / heuristic |
| --- | --- | --- |
| `not_aligned` | some frames have no registration data ("N frames couldn't be aligned"; the files do not say why) | measured / no |
| `round_cut` | kept frames are known and every aligned-but-dropped frame's roundness is below every kept frame's. The value is the midpoint at 2 decimals, or at the fewest further decimals that still lies above every dropped frame and at or below every kept one, so both "the dropped frames were below v" and Siril's `>= v` comparison hold | measured / no |
| `time_split` | kept frames are known and a half-hour boundary splits the timed frames into a part keeping at most `SPLIT_LOW` and a part keeping at least `SPLIT_HIGH` of its frames. Among such boundaries the one with the largest between-part variance `n1*n2/(n1+n2)*(p1-p2)^2` is used (earliest on ties) | measured / yes |
| `low_stars` | median stars per aligned frame below `LOW_STARS` | measured / yes |
| `calibration` | the night folder has dark/flat/bias folders; the coach says it does not use them yet and how they would change the steps | measured / no |

**Causes.** The only cause the report ever offers is low altitude, only in the `time_split` detail, only as text
beginning "Possible causes:", and only when the app's own Astropy altitude (target catalogue or library
coordinates, the night location's site, no refraction) is below `LOW_ALT_DEG` for every frame of the poor part
and at or above it for at least half of the good part's frames. The time given ("until HH:MM" when the target
rose, "from HH:MM on" when it set) is the first whole minute past the crossing. Cloud, dew and wind are never
named: the files record which frames were kept, not why. Site and target coordinates are used inside that
computation only and are never stored or returned.

**Rejecting a folder.** If fewer than `MIN_MATCH_FRACTION` of the registration sequence's frames match this
night's imported basenames, the upload is refused with "This Siril folder doesn't look like this night's frames
(M of N match)" and the run is left unchanged. Unsupported `.seq` versions, missing conversion files and folders
with no registered sequence are refused with their own messages.

**Constants (all heuristics, not Siril limits):**

| constant | value | meaning |
| --- | --- | --- |
| `MIN_MATCH_FRACTION` | 0.5 | share of the sequence's frames that must match this night's imported frames |
| `LOW_STARS` | 50 | median stars per aligned frame below which the night counts as star-poor (finding `low_stars`, advice `align.two_pass`) |
| `SPLIT_HIGH` | 0.85 | a "good" part of the night keeps at least this share of its frames |
| `SPLIT_LOW` | 0.60 | a "poor" part of the night keeps at most this share |
| `LOW_ALT_DEG` | 30 | altitude (degrees) below which low altitude is offered as a possible cause |
| `MIN_FRAMES_FOR_REJECTION` (`rules.py`) | 30 | frames to stack (kept, else aligned) from which `stack.rejection` suggests winsorized sigma clipping 3/3 |

**Advice from the report.** `align.two_pass` (basis measured, heuristic): when the median star count is below
`LOW_STARS`, suggest `register ... -2pass`. `stack.rejection` (basis siril-docs, heuristic, source: the Siril
command reference): with at least `MIN_FRAMES_FOR_REJECTION` frames to stack, suggest `rej w 3 3`; 3 and 3 are
common starting limits, not tuned to the night.

**Real-night check (local only).** `tests/test_processing_real_data.py` runs when `ASTROPLANNER_REAL_NIGHT_DIR`
points at a night folder; it reads the `.seq`/conversion text and the lights' FITS headers (for `DATE-OBS`) only.
On the tutorial night it gives 1,015 captured / 851 aligned / 654 kept, median 44 stars and FWHM 2.25 px, a
roundness cut at 0.743 (highest dropped 0.742286, lowest kept 0.744081), and "Before 03:30, 51 % of frames
reached the stack; from 03:30 on, 91 %", with no cause offered (the target stayed high).
