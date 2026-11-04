# Processing Coach: methods and sources

_Phase 4 (Processing Coach). Sections below, in build order: sources (gate G1), the night report rules and
constants, frame-selection options, the generated Siril scripts, stack measurement (`coach-measure-2`), advice from
a measured stack, the Seestar-versus-Siril comparison, and the local validation record._

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
| `unmatched` | some of the registration sequence's frames have no imported frame with the same basename ("N of this folder's M frames don't match this night's imported frames"). They stay in the totals (they may be this night's frames that were never imported) but not in the time chart; `totals.matched` / `totals.unmatched` give the counts | measured / no |
| `not_aligned` | some frames have no registration data ("N frames couldn't be aligned"; the files do not say why) | measured / no |
| `round_cut` | kept frames are known and every aligned-but-dropped frame's roundness is below every kept frame's. The value is the midpoint at 2 decimals, or at the fewest further decimals (up to 9) that lies above every dropped frame and strictly below every kept one, so both "the dropped frames were below v" and Siril's `>= v` comparison hold. Strictly below because Siril holds roundness as a 32-bit float (`float32(0.743) = 0.74299997`), so a limit equal to a kept frame's value would drop that frame | measured / no |
| `time_split` | kept frames are known and a half-hour boundary splits the timed frames into a part keeping at most `SPLIT_LOW` and a part keeping at least `SPLIT_HIGH` of its frames. Among such boundaries the one with the largest between-part variance `n1*n2/(n1+n2)*(p1-p2)^2` is used (earliest on ties) | measured / yes |
| `low_stars` | median stars per aligned frame below `LOW_STARS` | measured / yes |
| `calibration` | the night folder has dark/flat/bias folders; the coach says it does not use them yet and how they would change the steps | measured / no |

**Percentages** are whole numbers rounded half up, except that a share is never shown as 100 % unless every
frame reached the stack, nor as 0 % unless none did (99.6 % shows as 99 %, 0.4 % as 1 %).

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
| `MIN_FRAMES_FOR_REJECTION` (`rules.py`) | 30 | frames to stack (the saved frame choice's `kept`; before a choice, the folder's kept, else aligned) from which `stack.rejection` and the stack script use winsorized sigma clipping 3/3; below it both use no rejection (`rej n`) |

**Advice from the report.** `align.two_pass` (basis measured, heuristic): the coach's script always registers in
two passes; when the median star count is below `LOW_STARS`, this advice explains why that matters on this night
(it is not offered as a choice, since there is nothing to change). `stack.rejection` (basis siril-docs, heuristic, source: the Siril
command reference): with at least `MIN_FRAMES_FOR_REJECTION` frames to stack, `rej w 3 3` (3 and 3 are common starting limits, not
tuned to the night); below it, `rej n`, a plain average with no pixel rejection, with the warning that satellite
trails and hot pixels can stay. The advice and the stack script both call `rules.stack_rejection(n)` on the same
count (the chosen option's `kept`), so the step never says one thing while the script does another. The 30 is a
heuristic; with few frames the per-pixel spread is too poorly known for the coach to recommend clipping.

**Real-night check (local only).** `tests/test_processing_real_data.py` runs when `ASTROPLANNER_REAL_NIGHT_DIR`
points at a night folder; it reads the `.seq`/conversion text and the lights' FITS headers (for `DATE-OBS`) only.
On the tutorial night it gives 1,015 captured / 851 aligned / 654 kept, median 44 stars and FWHM 2.25 px, a
roundness cut at 0.743 (highest dropped 0.742286, lowest kept 0.744081), and "Before 03:30, 51 % of frames
reached the stack; from 03:30 on, 91 %", with no cause offered (the target stayed high).

## Frame-selection options (Phase 4 Task 7)

_`backend/app/processing/selection.py`._ Step 4 offers up to four options, each with the exact number of aligned
frames it keeps and their integration time, computed from the stored per-frame statistics (each frame's own
`EXPTIME` where known, else the capture set's most common exposure). Nothing is pre-selected, and the "last time"
note (the most recent other run on the same device with a saved choice) never selects anything.

| id | filter | kept frames |
| --- | --- | --- |
| `all` | none | every aligned frame |
| `previous` | `round`, value = the `round_cut` finding's separating cut | aligned frames with roundness >= value (only offered when that finding exists) |
| `round80` | `round`, `KEEP_PERCENT` % | Siril's percentage rule, see below |
| `wfwhm80` | `wfwhm`, `KEEP_PERCENT` % | Siril's percentage rule, see below |

`KEEP_PERCENT = 80` is a **heuristic** rule of thumb ("keep most, drop the worst fifth"), not a Siril default;
those two options carry the Heuristic tag. Counts follow Siril 1.4.5's rule (spec 2a, `sequence_filtering.c`):
with N frames in the sequence and n aligned, roundness `p%` uses `sorted_over_N[floor((100-p)(N-1)/100)]` with
unaligned frames counted as zeros (so it keeps **more** than `p` % of the aligned frames when any are unaligned;
the option note says "Siril's percentage, counted over all N frames"), and weighted-FWHM `p%` uses
`sorted_over_aligned[floor(p(n-1)/100)]`. Ties at the threshold are kept; a zero value never passes. Options with
the same filter and the same kept count are listed once. The `percent` (not the resolved threshold `value`) is what
the stack script passes to Siril. Choosing an option stores its id in `choices.selection`; the API rejects unknown
choice keys and ids not offered for the run (422), and re-reading the Siril folder clears the choice because the
counts may have changed.

**Which folder the counts describe.** The counts come from the Siril folder the coach read (`folder.run_dir`),
often the tutorial's `process/`, but script 2 always applies the filter to `process-coach/`, a separate
registration that may align a different set of frames. When the two differ, step 4, the stack step's script box and
the script's own comment say "These counts are from `process/`. Script 2 applies the same filter to
`process-coach/`, whose alignment may differ; choose the night folder again after script 1 and pick
`process-coach` to see its own counts." (`scripts.counts_note`; `selection_counts` in the run JSON). Durations are
floored everywhere (night report, step 4, script comments, Compare), in AstroLog's format: 8,510 s is "2 h 21 m".

## Generated Siril scripts (Phase 4 Task 8)

_`backend/app/processing/scripts.py`; served by `GET /api/processing/runs/{id}/scripts/{prepare|stack}` as
`astroplanner-<which>.ssf` (`text/plain; charset=utf-8`, attachment). Golden copies: `backend/tests/golden/`._
Both scripts start with `requires 1.4.5` (without it Siril 1.4.5 runs no line and still reports success), assume
Siril's working folder is the night folder (`siril-cli -d "<night folder>" -s "<folder you saved it in>/<file>"`,
or the Scripts menu after setting the working folder and adding the script's folder in Preferences, Scripts), use relative names only, and write only into `process-coach/` beside `lights/`.
Every command line is preceded by a comment giving the reason. **Probe (siril-cli 1.4.5):** a bare file name after
`-s` is looked up in the `-d` folder, not the shell's current folder (`File [b.ssf] does not exist (from CWD, use
absolute path?)`, exit 1), so the scripts, the step command and the step text all ask for the script's full path.

| script | commands |
| --- | --- |
| prepare | `cd lights`, `convert light -out=../process-coach`, `cd ../process-coach`, `calibrate light -debayer`, `register pp_light -2pass`, `close`; no filter, no `seqapplyreg` |
| stack | `cd process-coach`, `seqapplyreg pp_light <filter>`, `stack r_pp_light <rej> -norm=addscale -output_norm -rgb_equal -out=result_coach` (`<rej>` = `rej w 3 3` from 30 kept frames, else `rej n`; `rej n` checked by probe on 12 frames: "Not using rejection for stacking"), `close` |

`<filter>` is empty for `all`, `-filter-round=<value>` for `previous` (literal, Siril compares `>=`) and
`-filter-round=80%` / `-filter-wfwhm=80%` for the percentage options. The `previous` count compares
`float32(roundness) >= value`, as Siril does. The stack script is refused (409 "Choose
which frames to keep first.") until a selection is saved. The lights folder name is `Facts.lights_dir`
(default `lights`; a single folder name, quoted when it has a space).

**Disk estimate** (probe, spec 2a): each debayered or aligned frame is `width x height x 3 x 4 + 2880` bytes
(1080 x 1920 for the S30, so 24,886,080 bytes); `convert`'s links are about 140 bytes and are ignored. The
prepare script writes `frame_count` such frames (shown on the convert step); the stack script adds `kept` more
(shown on the stack step once frames are chosen), plus the stack itself. Before any download the prepare text also
states script 2's upper bound (`stack_max_bytes`, an aligned copy of every frame) and the total of the two (spec R1). On the real 1,015-frame S30 night
(2026-11-03) each written frame was 24,888,960 bytes (the S30 header with Siril's history needs two header blocks),
so the estimate ran 0.01 % low per frame; `du` of the whole coach folder (1,015 + 654 frames, the stack, star lists)
was 39 GiB against an estimate of 41.5 GB (38.7 GiB).

## Stack measurement (coach-measure-2)

_`backend/app/processing/measure.py`, `measure_stack(data, filename) -> (StackMeasurement, preview JPEG, thumb
JPEG)`; Phase 4 Task 9._ One fixed method, applied identically to any finished stack FITS (Siril's, the
Seestar's, the coach's), so two stacks can be put side by side as "same method, relative". The relative numbers
are fractions of **the image's brightness range (P99.5 - median of the luminance)**, not of the sky level. It is a
measurement, not a score: nothing is ranked and no winner is named. Pixels are measured in memory only; the
module stores nothing. Each result carries `method = "coach-measure-2"`; numbers from different methods are not
compared.

**Why -2 replaced -1 (the plan's formula).** The plan defined `noise_frac` as `1.4826 x MAD` of the pixels
below the 60th percentile, taken as they are. A background gradient then counts as noise: on synthetic images a
ramp of only about 7 sigma across the frame (`gradient_frac` 0.05) multiplied it by 2.48, a large ramp by 35, and
on the real stack it read 13 % high, the size of difference a Seestar-versus-Siril comparison exists to show. It
also read about 0.66 of the true sigma (the 60 % cut truncates the distribution), so it could not double as the
star-detection sigma. Method -2 subtracts a background model first and uses one sigma for both. Values of -1 and
-2 differ by definition (real stack: 0.0335 under -1, 0.0405 under -2) and must not be compared.

**Header facts (allow-list).** Only `STACKCNT` (frames), `LIVETIME` (s), `EXPTIME` (s), `PROGRAM`, `BAYERPAT`
and `ROWORDER` are read; astropy applies `BZERO`/`BSCALE` when it decodes the pixels. A missing or malformed
value is `None` ("not in file"). No other header value, in particular no site (`SITELAT`, `SITELONG`) or sky
coordinate, is read into the result. The first image HDU with at least two axes is measured. `HEADER_KEYS` in the module is that list, and a test pins it, so widening it is a deliberate change.

**Orientation and Bayer phase.** Rows are flipped for display only when the file declares
`ROWORDER = 'BOTTOM-UP'`; without the keyword, stored row 0 is shown at the top. This departs from the FITS
default (row 0 at the bottom) on purpose, from the real S30 night (2026-11-03): the S30 lights and Siril 1.4.5's
`siril-cli` stack of them carry no `ROWORDER`; Siril 1.4.4's stack of the same 654 frames says `BOTTOM-UP` and
holds exactly the same pixels with the rows reversed (maximum difference 0 after a row flip); and Siril 1.4.4's
own TIFF export (orientation tag 1, top-left) matches the `BOTTOM-UP` stack flipped (binned rank correlation 0.72
against 0.23 unflipped). With this rule both stacks give byte-identical previews, the same picture Siril
exported, and the field is not mirrored (a rough check of the Bubble, M52 and NGC 7538 against their catalogue positions gives the sky's handedness). The
FITS-default rule would have shown the 1.4.5 stack upside down. `ROWORDER = 'TOP-DOWN'` is not flipped.
`BAYERPAT` (RGGB, BGGR, GRBG, GBRG) is the pattern at stored pixel (0, 0), applied before any flip: on an S30
light this reproduces Siril 1.4.5's own debayer (per-channel correlation 0.80 / 0.97 / 0.80 and the same channel
ratios; the vertically shifted reading does not). Not checked on a real 2-D file that declares `ROWORDER`. The
measured numbers are whole-image statistics, so orientation changes only the preview.

**Pixels.** A 2-D image with a recognised `BAYERPAT` is reduced to colour by a 2x2 super-pixel (R, mean of the
two G, B; no interpolation; an odd last row or column is dropped), so its stars are measured at half size.
Luminance `L` = mean of the channels (the single channel for mono). **Valid pixels** are those where `L` is
finite and not exactly 0; exact zeros are what registration and field rotation leave in the corners and edges
of a stack (the Seestar is alt-az). Every statistic below uses valid pixels only.

| quantity | definition |
| --- | --- |
| brightness range | `scale = P99.5(L) - median(L)`; every fraction below is divided by it, so multiplying the image by a constant or adding an offset changes nothing |
| tile medians | median of the valid pixels in each tile of an 8 x 8 grid (a tile with under 10 % valid pixels has none) |
| background model | bilinear surface through the tile medians at the tile centres, extrapolated linearly to the image edges (a tile without a median takes its nearest tile's); removes gradients and vignetting on scales larger than a tile |
| `noise_frac` | `sigma / scale`, where `sigma` is the standard deviation of `L - background model` over valid pixels after sigma clipping (`astropy.stats.sigma_clipped_stats`, 3 sigma, 5 iterations; stars and bright nebula are clipped) |
| `gradient_frac` | least-squares plane `a + b x + c y` through the tile medians (tile centres as x, y); (max - min) of the plane over the image's four corners / `scale` |
| `gradient_residual_frac` | `1.4826 x MAD` of the tile medians minus the plane / `scale` (structure a plane does not explain: nebula, vignetting, uneven sky) |
| `bg_rgb_ratio` | median of each channel over the valid pixels with `L` below its 60th percentile, divided by the mean of the three; `None` for mono |
| `star_fwhm_px` | median of the fitted FWHMs (below); `None` when fewer than 5 stars fit |

**Stars.** Everything runs on `L - background model` (invalid pixels set to 0) with the same `sigma` as
`noise_frac`. Detection: `photutils.detection.DAOStarFinder` (kernel FWHM 3 px, `min_separation=0`, default
sharpness/roundness limits), threshold 5 sigma. Kept: detections whose peak is below 90 % of the maximum
(unsaturated), whose fit window plus a 2-px ring lies inside the image and wholly on valid pixels, and with no
other detection within one window width (isolated); the 200 brightest by flux. Fit: each star's window minus the
median of the 2-px ring around it (local background), then `photutils.psf.fit_fwhm` (circular Gaussian PRF) with
a 9 x 9 window; if the median FWHM asks for a wider window (`3 x FWHM`, odd, 9-25 px), select and fit again once
with it. Fits that are non-finite, below 0.5 px or wider than the window are dropped. For a super-pixelled image
the FWHM is doubled back to the file's pixels.

**Preview stretch (`coach_stretch`).** Per channel (unlinked): sigma = 1.4826 MAD; black point = max(median -
2.8 sigma, channel minimum); white point = channel maximum; then the midtones transfer
`y = (m - 1) x / ((2m - 1) x - m)` with `m` chosen so the median lands at 0.25. The same stretch is used for
every stack, so previews differ only where the data differ. Preview 1,600 px and thumbnail 400 px on the long
edge, re-encoded JPEGs with no EXIF/ICC (the AstroLog preview writer). Its median and MAD also leave out exact zeros and non-finite pixels, which are drawn black.

**Checked on synthetic images (`tests/test_processing_measure.py`).**
- Pixel-integrated Gaussian stars of FWHM 3.0 px measure 3.000 px (tolerance 0.15).
- Multiplying the image by 7 and adding 500 leaves `noise_frac` unchanged (ratio 1.0000); doubling the noise
  doubles it (ratio 2.009).
- Ramps of 10 and 20 counts (2 and 4 per-channel sigma) change `noise_frac` by +0.4 % (tolerance 5 %). A ramp of 300 changes it by
  -0.3 % and gives `gradient_frac` 0.74 and `gradient_residual_frac` 0.0007.
- Vignetting (corners 40 counts darker) changes `noise_frac` by +2.3 %.
- A 5 % column of zeros on the 20-count ramp changes `noise_frac` by +1.2 % and `gradient_frac` by -0.3 %
  (tolerance 3 %).
- A green-biased background gives `bg_rgb_ratio` (0.96, 1.08, 0.96). A 2-D GRBG uint16 frame with
  `BZERO = 32768` returns the channel ratios it was built with.
- A star-free image reports no FWHM.
- A full-size 1080 x 1920 x 3 float32 image measures in about 0.7 s on a laptop.

**Real-night check (local only, 2026-11-03).** Siril 1.4.4's stack of the tutorial night and the coach's
Siril 1.4.5 stack of the same 654 frames hold the same pixels, so they measure identically:

| field | value |
| --- | --- |
| frames | 654 |
| integration | 6,540 s |
| `star_fwhm_px` | 2.19 px from 200 stars (Siril's per-frame FWHM of the 654 kept frames: 1.97-3.10, median 2.21) |
| `noise_frac` | 0.0405 |
| `gradient_frac` | 0.156 |
| `gradient_residual_frac` | 0.026 |
| `bg_rgb_ratio` | (0.999, 1.000, 1.001), Siril's "equalized RGB" |

Each stack measures in about 0.9-1.5 s.

**Limitations.**
- **The brightness range depends on star sharpness.** P99.5 falls on star pixels, so softer stars lower `scale`
  and raise `noise_frac` a little: +2.1 % for FWHM 3.0 to 3.6 (+2.4 % under -1), and +14 % for 3.0 to 4.5,
  with the same noise. Read `noise_frac` together with `star_fwhm_px`.
- **Per-pixel noise depends on binning.** A super-pixelled (2x2) Bayer stack averages four pixels per output
  pixel, so its noise is not comparable with a debayered full-size stack of the same data. Compare like with
  like, and use the "same method" label only between images of the same kind.
- **The background model has a scale.** It follows structure larger than a tile (1/8 of the frame). Smaller
  background structure, such as nebula, stays in the residual, and the sigma clipping removes only its bright
  part.
- **Super-pixelling widens stars.** The FWHM of a super-pixelled image is slightly widened by the 2x2 binning
  (within 0.6 px of the truth in the test).
- **Saturation uses the maximum.** The saturation rule compares against the maximum, so one hot pixel brighter
  than every star lets saturated stars through.

## Advice from a measured stack (Phase 4 Task 10)

_`rules.py` (background, colour and stretch rules), `routes.py` (`POST /api/processing/runs/{id}/stacks/{side}`,
`side` = `siril` or `seestar`; `GET .../images/{key}`)._ The developer adds their Siril stack; the backend measures
it with `coach-measure-2` (above) in memory and stores only the numbers and two metadata-free JPEGs (preview,
thumbnail) under `comparison["<side>_stack"]`; the FITS itself and its header values (including any site
coordinates) are never stored or returned. Re-uploading replaces the stack and deletes its old JPEGs. Only FITS
(`.fit/.fits/.fts`) is accepted ("Stacks must be FITS files", 422); images under 64 px (`MIN_EDGE`) on either side
and any non-finite measurement are 422; the size limit is the AstroLog upload limit. Only the **Siril** stack
drives advice; the Seestar stack is kept for the compare step.

| rule (`basis`, all heuristic) | constant | meaning |
| --- | --- | --- |
| `background.degree` (`measured`) | `RESIDUAL_FOR_DEGREE2 = 0.01` | degree 1 (`subsky 1`) when `gradient_residual_frac` is under 1 % of the brightness range, else degree 2. The text quotes `gradient_frac` and `gradient_residual_frac` as percents of the image's brightness range |
| `colour.cast` (`measured`) | `COLOUR_CAST_RATIO = 1.05` | when the strongest of `bg_rgb_ratio` exceeds 1.05 the advice names that channel and says colour calibration (`pcc`/`spcc`) corrects it, and that both need plate solving. Otherwise it reports no strong cast (and says that neutral background is not the same as right star colours). A mono stack has no ratio and gets the tutorial default |
| `stretch.start` (`taste`) | none | start from `autostretch`; with a stack the text also quotes `noise_frac` as a percent of the brightness range. No number is chosen for the stretch |

Both constants are rules of thumb chosen by the coach, not Siril values; nothing derives them. Without a Siril
stack the three steps show `tutorial-default` (background, colour) or `taste` (stretch) advice and the prompt
"Add your Siril stack to get advice for this night". There is no score and no winner.

**Limitations of the stack advice (Task 10 fixes).**
- **A neutral colour reading is expected after equalized stacking.** The coach's stack script runs
  `stack ... -rgb_equal`, and Siril's "equalize RGB" levels the background channels during stacking, so a stack
  made that way (or by a tutorial that ticks it) reads about 1 : 1 : 1 whatever the sky's colour was (the real
  stack: 0.999 : 1.000 : 1.001). When the header's `HISTORY` contains "equalized RGB" (Siril writes it; text wrapped
  across cards is joined first) the advice says so definitively; the stored `rgb_equalized` is then `true`. When it
  does not, `rgb_equalized` is `None` and the advice is conditional ("if the stack was made with the coach's script
  or with 'equalize RGB' ..."). It is never `false`: a header without the phrase does not prove the stack was not
  equalized. `HISTORY` is read only to search for that phrase and is not stored. A measured cast (over 1.05) is
  reported as measured either way.
- **Degree-2 background advice cannot tell nebula from sky gradient.** `gradient_residual_frac` includes large
  nebula, so the advice states that first and gives a check: if Siril's background model shows the nebula's shape,
  or the nebula looks dimmer after extraction, undo and use degree 1.
- `gradient_frac` is the fitted plane's maximum minus minimum over the image's four corners, so the text says
  "between opposite corners".
- The 64 px minimum edge (`MIN_EDGE`) is applied to the image the 8 x 8 grid sees, i.e. after the 2 x 2 super-pixel
  of a colour-mosaic file, so a Bayer file needs at least 128 px per side.

## Seestar versus Siril comparison (Phase 4 Task 11)

_`routes.py` (`POST /api/processing/runs/{id}/pictures/seestar`, `POST .../stacks/{side}`, `PATCH .../runs/{id}`
with `comparison`), `CompareStep.tsx`._ Step 10 has two views over the same two sides, with nothing ranked and no
winner:

- **Final pictures** shows the picture you made from the Seestar's own result (JPEG, PNG or TIFF; only two
  metadata-free previews are kept) beside the target's current AstroLog final picture. It shows **no numbers**:
  taste and editing differ between pictures. If the Seestar picture's metadata names editing software, the picture is
  marked edited (`edited_by` records the software name); the user can set the flag by hand (`PATCH` accepts only
  `{"seestar_picture": {"edited": true | false | null}}`). An edited picture gets no measurements.
- **Stacks (measured)** shows the two unedited stack FITS files with the same preview stretch and the same
  `coach-measure-2` measurements, each relative to its own image. Numbers are shown only for a stack measured with
  the current method version; a stack stored under another version is treated as absent and the step says to add it
  again, so figures from different methods are never put side by side. Only the Siril stack drives advice.

Both sides start empty and say so ("No Seestar picture yet.", "No final picture yet.", "No measurements for this
side yet.", "No stack yet.") with the action that fills them. The measured comparison has been run on synthetic data
and on the developer's real Siril stack only: no Seestar stacked FITS has been supplied yet (gate G2), so the claim
"the same method gives comparable numbers across the two devices' stacks" is untested on real Seestar output.

## Local real-data validation (Phase 4 Task 12)

Local checks on the developer's Bubble Nebula night (2026-09-11/12, 1,015 frames); not part of CI, not repeatable
without that folder. Recorded in `PROGRESS.md` with the commands.

| check | result |
| --- | --- |
| night report on the existing Siril run | 1,015 captured / 851 aligned / 654 kept; median 44 stars, FWHM 2.25 px; "Before 03:30, 51 % of frames reached the stack; from 03:30 on, 91 %"; round cut 0.743 |
| `siril-cli` 1.4.5, coach script 1 (prepare) | 41 s; 1,015 converted, 851 registered |
| `siril-cli` 1.4.5, coach script 2 (stack, "same as last time" selection) | 66 s; `STACKCNT` 654, `LIVETIME` 6540 |
| the developer's `lights/` and `process/` before and after | fingerprints identical (the scripts write only into `process-coach/`) |
| `coach-measure-2` on the real Siril stack | FWHM 2.19 px, noise 0.0405 of the brightness range, gradient 0.156, residual 0.026, colour 0.999 : 1.000 : 1.001 with "equalized RGB" in the header |

