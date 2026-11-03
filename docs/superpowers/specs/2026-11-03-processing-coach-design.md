# Phase 4 design: Processing Coach

_Status: builder-checked, awaiting developer approval · 2026-11-03 · follows ROADMAP.md "How each phase is run", Design steps 1–5_
_Brainstormed with the developer. The developer decided: the purpose (below), that photometry moves to a later
phase, the step-by-step "coach" layout (mockup option B), Siril doing the measuring, the Seestar-vs-Siril
side-by-side ending, and (after the builder check) that finished stacks are measured on the local backend, that
they will supply a Seestar stacked FITS, that the builder may run `siril-cli` on the real folder, and that the
mockups are committed as-is. Items marked **(Claude's call)** were not decided by the developer and may be changed
by the builder if they find a better option, saying so in the plan._

Mockups (approved in the browser companion, 2026-11-03), committed with this spec under
`docs/superpowers/mockups/2026-11-03-processing-coach/`: `processing-guide.html` (night report + option B coach)
and `compare.html` (step 10). They contain the developer's real Bubble Nebula images and numbers (no coordinates
or paths); the developer approved committing them to the public repo.

## 1. Intent

The developer images deep-sky targets overnight with a Seestar S30 (original S30, not Pro), then re-stacks the raw
frames in **Siril** because doing it themself "sometimes turns out better" than the Seestar's automatic stack,
then finishes in **Lightroom**. Today they follow a tutorial for every Siril step without knowing why
("all of it bro, i followed a tutorial").

Success, in the developer's words: **"i'd know which settings to use without a tutorial, and get step by step what
to do to get a good final image."**

Phase 4 is a **Processing Coach**: for one imaged night already in AstroLog, it walks the developer through
processing in Siril one step at a time. Each step explains what it does, which setting to use and **why that
setting fits this night's frames**, and what they should see in Siril afterwards. It reads Siril's own output to
show what happened to the frames, and ends with the Seestar's result next to theirs.

It does **not** replace Siril. Siril does all pixel processing of the raw frames; the coach explains, recommends
from measured facts, writes Siril scripts, and keeps a record.

The project is a portfolio piece; every number must be traceable to a file and a documented method.

## 2. What we know (recon on 2026-11-03, recorded so the builder need not repeat it)

Real night: NGC 7635 (Bubble Nebula), 2026-09-11/12, folder `~/Astrophotography/Bubble Nebula/`
(local only; never commit it or anything containing its paths or coordinates).

- **Folder layout after a Siril run:** `lights/` (1,015 S30 FITS, 3.9 GB), `process/` (Siril working folder),
  the stack `NGC_7635_654x10sec_T32degC_2026-09-11.fit`, and `starnet_…tif` (StarNet output). The developer's
  Lightroom export and the Seestar stack are **not** in the folder.
- **S30 light frame headers:** `CREATOR='ZWO Seestar S30'`, `INSTRUME='Seestar S30'`, 1080×1920, BITPIX 16,
  `BAYERPAT='GRBG'`, `EXPTIME=10`, `GAIN=200`, `FILTER='LP'`, `CCD-TEMP` 30–32 °C, `BIAS=961`, `DATE-OBS` in UTC,
  plus `SITELAT/SITELONG` (site coordinates: privacy, see §6). File names carry **local** time
  (`Light_NGC 7635_10.0s_LP_20260911-231147.fit` = 2026-09-12T03:11 UTC, EDT).
- **Siril's stack header:** `PROGRAM='Siril 1.4.4'`, `STACKCNT=654`, `LIVETIME=6540`, `ROWORDER='BOTTOM-UP'`,
  NAXIS3=3 float32, and `HISTORY` lines recording the stack method: "mean stacking with winsorized sigma clipping
  rejection (low=3.000 high=3.000), additive+scaling normalized input, normalized output, no image weighting,
  equalized RGB".
- **`process/` contents:** `light_conversion.txt` (lines `'<absolute source path>' -> '../process/light_00001.fit'`),
  sequences `light_.seq` (1,015, no registration), `pp_light_.seq` (1,015 images, 851 selected, registration
  data), `r_pp_light_.seq` (654 registered frames), `result.fit`, per-frame star lists in `cache/*.lst`.
- **`.seq` format as observed** (version 6; must be verified, gate G1): `S 'name' start nb_images nb_selected
  fixed_len reference_image version …`; `L <layers>`; `I <index> <selected 0|1>`; one `R<layer>` line per image
  that reads as `fwhm weighted_fwhm roundness quality background_lvl number_of_stars H <homography…>`;
  `M<layer>-<index>` lines with per-frame statistics.
- **What happened that night, from those files:**
  - 1,015 frames × 10 s = 2 h 49 m captured. 164 have no registration data (Siril could not align them);
    851 were aligned; **654** went into the stack (1 h 49 m).
  - The 197 aligned-but-dropped frames are exactly those with roundness < 0.743 (every kept frame ≥ 0.744), so
    the tutorial's filter was a roundness cut.
  - Per frame (aligned): stars median 44 (13–64), FWHM median 2.25 px, weighted FWHM median 3.66 px,
    roundness median 0.81.
  - By time: before 03:30 local, 51 % of frames reached the stack; from 03:30 on, 91 %.
- **Seestar's result as supplied:** a JPEG from the macOS Photos library internals
  (`…/resources/derivatives/…_1_105_c.jpeg`), 665×1182, EXIF `Software='Adobe Lightroom 11.5.21 (iOS)'`,
  `Model='Seestar S30'`. It is an **edited, reduced copy**, not the Seestar's stacked FITS. Framing differs from
  the Siril stack; the reason is unknown (do not claim "cropped").
- **Installed:** Siril 1.4.4 with `siril-cli` at `/Applications/Siril.app/Contents/MacOS/siril-cli`; the developer
  is upgrading to **1.4.5**. StarNet 2.6.0 CLI is installed separately. No dark/flat/bias frames exist.
- **Existing app pieces to reuse:** AstroLog `CaptureSet` (one per night × target × device), `CaptureFrame`
  (`source_filename`, `date_obs_utc`, `exptime_s`, `gain`, `filter`, `ccd_temp_c`), `Stack` (header-only record
  of stacks incl. `stack_count`, `livetime_s`, `program`), `FinalImage` (uploaded picture with stored preview and
  thumb, `previews.make_previews`). The import page already uses a browser folder picker (`webkitdirectory`) and
  slices FITS headers in the browser. Variable Hunter's star page shows a "Coming in Phase 4" slot for photometry.

## 3. Goals

1. **Process this night**: a button on a night's AstroLog target page (per capture set) that opens the coach for
   that night. Only Seestar S30 FITS light frames are supported in this phase.
2. **The coach** (mockup option B): a step rail and one step per screen. Steps (Claude's call on exact split):
   1 Night report · 2 Convert & debayer · 3 Align · 4 Choose frames · 5 Stack · 6 Background ·
   7 Colour · 8 Stretch · 9 Stars & finish · 10 Compare. Each step shows: what it does (plain words), the
   setting(s), **why** (citing this night's measured facts, a documented rule, or labelled "tutorial default" /
   "your taste"), how to do it in the Siril GUI, the equivalent Siril command, and "you should see …".
3. **First script.** Step 2–3 give a downloadable Siril script (`.ssf`) that converts, debayers and registers
   **all** lights **without** filtering, so every frame gets measured. Every line has a comment saying why.
   **(Claude's call)** Coach scripts work in their own folder (e.g. `process-coach/`) and never write into an
   existing `process/` folder, so an earlier run is never overwritten. Before download, the coach states the
   expected disk use (the developer's existing `process/` is **39 GB**; 134 GB free on 2026-11-03) and offers a
   cleanup step for intermediate files after stacking (mechanism after G1).
   On a night with no Siril run yet, step 1 (Night report) shows "run the first script, then pick its folder"
   instead of a report; the rail order stays as in the mockup.
4. **Night report from Siril's output.** The developer can pick **either** an existing Siril working folder
   (such as the 1.4.4 tutorial run, `.seq` version 6) **or** the coach's own folder **(Claude's call)**. They pick the folder
   in the browser; the app reads only the `.seq` files and `light_conversion.txt` (never pixel files) and shows
   the mockup's report: totals (captured / aligned / in stack), per-frame star count, FWHM, roundness and
   background, a frames-through-the-night chart in the observer's timezone, and "what stands out" findings
   generated from fixed, documented rules.
5. **Frame-selection trade-off** (step 4): two or more concrete options computed from the measured frames
   (e.g. "keep every aligned frame" vs a roundness and/or FWHM cut), each showing frames kept and integration
   time. The developer picks; nothing is chosen silently. Re-reading the folder after a later run shows what Siril
   actually kept.
6. **Second script** with the developer's choices for selection and stacking (steps 4–5). Post-stack steps
   (6–9) are guided in the GUI with commands shown where Siril has them; whether they also go in a script is the
   builder's call after G1.
6a. **Advice for steps 6–9 from the developer's stack** (developer approved reading stacks). After stacking, the
   developer adds their Siril stack; the backend measures it (§7.5 rules: in memory, not stored) for facts that
   bear on the next steps, for example how strong and which shape the background gradient is (→ background
   extraction degree), the colour balance of the sky background (→ what colour calibration will correct), and
   the background level and noise (→ a starting stretch). Each piece of advice carries a basis label; anything
   the measurement cannot support stays "tutorial default" or "your taste". The exact measurements are fixed in
   the plan and documented in `docs/PROCESSING.md`.
7. **Compare** (step 10, mockup `compare.html`), two modes:
   - **Final pictures**: Seestar picture vs the developer's final picture side by side, each labelled with its
     source and whether it was edited (from metadata where present, else the developer says). **No numbers.**
   - **Stacks (measured)**: the Seestar's stacked FITS vs the developer's Siril stack, both shown with the **same**
     preview stretch, plus frames used and exposure time (from headers), median star FWHM and background noise
     (measured by one documented method applied identically to both). No winner score.
   Each missing input has an explicit empty state with an "Add …" action (mockup).
8. **Persistence**: the coach's progress, choices, parsed frame statistics and comparison inputs are saved with
   the capture set, so returning shows where they left off and, on a later night, "last time you kept 654 frames
   with roundness ≥ 0.74".
9. **Roadmap update**: Phase 4 becomes "Processing Coach"; scientific image analysis (photometry, user light
   curves) moves to Phase 5 and "Advanced features" to Phase 6 **(Claude's call on numbering)**. The Variable
   Hunter "Coming in Phase 4" text changes to "Planned for a later phase" (otherwise it becomes untrue).

## 4. Non-goals (Phase 4)

- Photometry, light curves from the developer's images, AAVSO submission (later phase).
- Any pixel processing of raw light frames by the app (Siril does it).
- Other cameras or the Seestar S30 Pro/S50, Canon CR2 processing, other Siril versions than 1.4.5 (1.4.4 may work
  but is not the target), Moon/planet/lucky imaging, mosaics, drizzle, dark/flat/bias calibration (if such
  frames are present the coach says they are not supported yet and how they would change the steps).
- Lightroom guidance beyond "finish here; this part is your taste".
- Running Siril from the app, or controlling the Seestar.
- Combining several nights of one target into one stack **(Claude's call)**: one coach run belongs to one capture
  set; multi-night stacking would be a later addition with its own link table.

## 5. Anti-goals (would make it a failure even if it works)

- A recommended setting with no stated reason, or a reason that is not true for this night.
- A made-up "image quality" or "processing score", or a "winner" in the comparison.
- Numbers measured from an edited JPEG presented as comparable to numbers from a stack.
- Copying a tutorial's fixed numbers and presenting them as tailored.
- Rebuilding Siril features badly in the browser.
- Any text that would mislead about what Siril did (e.g. explaining a drop with a cause the data does not show:
  "clouds" is a possible cause, not a finding, unless the background data supports it, and even then hedged).

## 6. Constraints

- All `CLAUDE.md` nonnegotiables apply (UTC internally, observer IANA timezone for display, no dead buttons,
  loading/error/empty states, accessible labels, responsive, night vision, no claimed tests that were not run).
- **Raw frame pixels never leave the disk.** The browser reads only `.seq` / `light_conversion.txt` text from the
  picked folder (filter by name before reading; do not read other files).
- **Absolute paths are not stored**: keep only basenames from `light_conversion.txt`; match them to
  `CaptureFrame.source_filename` to get each frame's `date_obs_utc`. Frames that don't match are counted and
  reported, never guessed.
- **Header coordinates are never stored or returned** (Phase 2 rule; SITELAT/SITELONG in S30 FITS).
- **Stacks** (developer decided): stack FITS files (the developer's Siril stack and the Seestar's stack) are
  sent to the local backend for measurement, processed in memory, and **not stored**; only a preview JPEG/thumb
  (like `FinalImage`) and the measured numbers are stored. Upload limit sized for a 1080×1920×3 float32 stack
  (~25 MB). Raw light frames are never uploaded. (Before any public deployment, re-check this against the
  hosting request-size limit; ROADMAP deployment section.)
- DB changes through an Alembic migration that works on SQLite and Postgres (`DATABASE_URL` seam).
- Siril is GPL-3.0: the app writes scripts and reads Siril's output files; **no Siril code is copied**. Siril
  documentation is linked, not reproduced; explanations are written in our own words.
- StarNet is third-party with its own licence: the coach may mention it and link it, nothing more.
- Dependencies: any new Python package (e.g. `photutils`, BSD-3) is added to `requirements.txt` with its licence
  noted in the attribution file.

## 7. Decisions

### 7.1 Siril does the measuring (developer decided)
Per-frame FWHM, roundness, star count and background come from Siril's `.seq` registration data, so the
developer can find the same numbers in Siril. The app never recomputes them from raw frames.

### 7.2 Recommendation rules (Claude's call on the mechanism)
Recommendations come from a small, versioned rule table in code (e.g. `processing/rules.py`), each rule with:
condition on measured facts, setting, explanation text, and its basis (`measured`, `siril-docs` with URL,
`tutorial-default`, `taste`). Rules are documented in `docs/PROCESSING.md`. Every threshold not taken from Siril's
documentation is labelled a heuristic in the UI. Initial rules are few (convert/debayer from `BAYERPAT`; two-pass
registration when stars per frame are low; the selection options; stacking rejection by frame count); the
builder proposes the list in the plan with sources.

### 7.3 Night-report findings (Claude's call)
Generated by fixed rules from the parsed data, e.g. "N frames could not be aligned", "before HH:MM local, X % of
frames reached the stack", "no dark or flat frames in the folder". A cause (cloud, dew, wind, low altitude) is
only offered as "possible causes" and only when supported (e.g. background rise for cloud; the app's own altitude
computation for low altitude).

### 7.4 Frame-selection options (Claude's call)
Options are generated from the measured distribution and show exact counts and integration time computed from
the data. "What you chose last time" appears when a previous coach run exists for the same equipment.

### 7.5 Comparison measurements (Claude's call; method to be fixed in the plan)
- Frames and exposure: from headers (`STACKCNT`, `LIVETIME` or equivalent for Seestar stacks; missing → "not in
  file").
- Star FWHM and background noise: measured on both stacks by the same documented method (e.g. photutils star
  detection + profile fit; robust background noise expressed **relative to the sky level** so different pixel
  scales compare). Labelled "same method, relative" with the method in `docs/PROCESSING.md`.
- Preview stretch: one fixed, documented auto-stretch (median/MAD-based) applied identically to both.
- Different image sizes or orientations: compare per-image statistics, never pixel-by-pixel.

### 7.6 Data model (Claude's call)
A `processing_runs` table (one per capture set; id, capture_set_id FK RESTRICT, siril_version, step_states JSON,
choices JSON, frame_stats JSON (per frame: basename, utc, fwhm, wfwhm, roundness, background, stars, aligned,
kept), comparison JSON, created/updated). A run must never be deleted as a side effect of other deletes.

### 7.7 UI (developer approved the mockups)
Real theme ("Clean Planetarium") and red night vision; the coach rail becomes a horizontal scroller on mobile;
chart via the existing lazy chart library; every button works or is not shown.

## 8. Gates and risks

- **G1 — Siril 1.4.5 facts verified before code depends on them:** script command syntax (`requires`, `convert`,
  `calibrate` with debayer, `register` two-pass, `seqapplyreg` filters, `stack` options, background extraction,
  colour calibration, stretch, `starnet`), and the `.seq` version-6 field order (from Siril's docs/source; reading
  GPL source to learn a file format is fine, copying it is not). Record what was read, with URLs, in the spec's
  recon section. If 1.4.5 is not released or docs are unreachable, stop and tell the developer.
- **G2 — Seestar stacked FITS:** the developer says they can get one. Before the comparison milestone, ask them
  for its location and record its header (frame count, exposure, dimensions, data type) in the recon section;
  the measured mode is validated on that real file. Until it arrives, the measured mode shows its empty state.
- **R1 Script correctness:** a wrong script wastes a night's processing. Mitigation: the builder runs the
  generated scripts with `siril-cli` 1.4.5 on the real Bubble Nebula folder (developer approved), writing only
  into the coach's own folder (e.g. `process-coach/`), never into `lights/` or the existing `process/`. That
  folder is deleted afterwards **only with the developer's OK**. Check free disk space first (~40 GB needed).
- **R2 Recommendations that sound authoritative but aren't:** mitigated by §7.2 basis labels and review.
- **R3 `.seq` parsing on other nights/versions:** version check; unknown version → clear error, no partial guess.
- **R4 Stack upload vs the Phase 2 "image data never leaves the disk" rule:** resolved by the developer: stacks
  (not raws) go to the *local* backend transiently. Record this as a decision-log entry in ROADMAP.md.
- **R5 Time attribution:** frames not imported in AstroLog have no `date_obs_utc`; report them as "time unknown"
  rather than parse local-time file names silently (or parse with explicit labelling, builder's call).
- **R6 Big folders:** `process/` has ~2,700 entries; the picker must filter by name and read only small text files.
- **R7 Public repo:** the developer approved committing the mockups and screenshots with their real images and
  numbers. Still never commit real data files (FITS, `.seq`, `light_conversion.txt`), anything with absolute
  paths, or header coordinates; tests use synthetic `.seq` fixtures plus optional local real-data checks skipped
  in CI.

## 9. Acceptance criteria

1. From a Bubble Nebula capture set, "Process this night" opens the coach; the first script downloads, and
   `siril-cli` 1.4.5 runs it without error on the real folder (local check, documented in PROGRESS.md).
2. Picking the existing tutorial `process/` folder produces a report whose totals match Siril's files exactly
   (1,015 / 851 / 654 for the 2026-09-12 run), with times in America/New_York; picking the coach's own folder
   produces totals that match the `.seq` files that run wrote (whatever Siril 1.4.5 aligned), checked by a
   script independent of the app's parser.
3. The selection step offers options whose counts and integration times equal what Siril produces when the
   second script is run with that option (local check).
4. Every recommendation on screen shows its basis label; a unit test fails if a rule lacks one.
5. Compare: both modes render with real inputs; each missing input shows its empty state; the measured mode
   uses the same stretch and method on both sides (test with synthetic stacks of known FWHM/noise, including
   different scales).
6. Night vision has no white/blue; mobile layout works; keyboard and screen-reader labels on all controls.
7. Raw frame contents are never read by the browser code (test that only `.seq`/`.txt` files are opened).
8. Backend, unit and e2e suites pass, including all Phase 1–3 tests; new pytest for parsing, rules, selection
   arithmetic, timezone handling and measurement; new Vitest for the coach; Playwright smoke for the coach with
   synthetic fixtures on desktop and mobile.
9. README, `docs/PROCESSING.md`, ARCHITECTURE, ROADMAP (renumbered phases) and PROGRESS updated.

## 10. Left to the builder

Exact step split and wording; file/module layout; API shape; chart details; whether post-stack steps go into a
script; how the "what you should see" text is verified; fixture design; milestone order (UI milestone early so
the developer can click through the coach mid-phase).

## 2a. Recon: Siril 1.4.5 (G1)

_Recorded 2026-11-03 by the Task 1 builder. Facts are in my own words; URLs are the places read. Siril is
GPL-3.0 and its documentation has its own licence, so nothing here is copied from either. "Probe" means a throwaway
run of `siril-cli` 1.4.5 on a 40-frame synthetic night (60 Gaussian stars on noise, four blank frames, shifts of
a few pixels, GRBG header) built in a scratch folder; no real data was touched. Probe output is the authority when
it differs from reading._

**Version.** `siril-cli --version` prints `siril 1.4.5`. The "stable" command reference
(<https://siril.readthedocs.io/en/stable/Commands.html>) is headed "Siril 1.4.4 documentation"; the built-in
`help <command>` of the installed 1.4.5 prints the same syntax lines for every command below, so the reference
is valid for 1.4.5. Source tag: <https://gitlab.com/free-astro/siril/-/tree/1.4.5>.

### Script mechanics

- A script must begin with `requires <min>`. **Probe:** without it Siril logs "requires command is missing",
  executes none of the lines, and still ends with "Script execution finished successfully" (exit looks fine).
  Generated scripts therefore start with `requires 1.4.5`; the coach must also say this in the step text.
- `requires min [obsolete]` fails if Siril is older than `min`, or at/after `obsolete` (optional).
- `cd directory`: `~` expands, quote names with spaces; relative paths are relative to the current directory
  (set with `-d` on the command line, then moved by each `cd`).
- `convert basename [-debayer] [-fitseq] [-ser] [-start=index] [-out=dir]`. FITS inputs are **symlinked** (copied if
  linking fails; `-debayer` disables linking). `-out=` sets the output directory. **Probe:** from inside the
  lights folder, `convert light -out=../w` creates `w/light_00001.fit` ... (symlinks of 139 bytes), `w/light_.seq`
  (name is the basename plus `_`) and `w/light_conversion.txt`. Each conversion line is
  `'<source path as given>' -> '<dest path relative to the folder convert ran in>'`, one per image, in order;
  numbering starts at 1 (`-start=` changes it). Parse the source **basename** only.
  A harmless "Reading sequence failed ... light.seq" line is printed before the sequence is first written.
- `calibrate sequencename [-bias=] [-dark=] [-flat=] [-cc=...] [-cfa] [-debayer] [-fix_xtrans] [-equalize_cfa]
  [-opt[=exp]] [-all] [-prefix=] [-fitseq]`. Output prefix defaults to `pp_`. `-debayer` demosaics before saving;
  `-cfa` only applies cosmetic correction to CFA data; `-equalize_cfa` equalises the RGB means of the *master
  flat* (irrelevant with no flats). **Probe:** `calibrate light -debayer` with no bias/dark/flat runs, reads
  `BAYERPAT` ("Filter Pattern: GRBG from header", orientation taken from Siril settings) and writes
  `pp_light_NNNNN.fit` as 3-layer 32-bit float and `pp_light_.seq`.
- `register sequencename [-2pass] [-selected] [-prefix=] [-scale=] [-layer=] [-transf=] [-minpairs=] [-maxstars=]
  [-nostarlist] [-disto=] [-interp=] [-noclamp] [-drizzle ...]`. `-2pass` finds a reference frame, computes the
  transforms **and writes no images** (apply them with `seqapplyreg`). Default transform is homography; detection
  runs on the green layer for colour images. **Probe:** `register pp_light -2pass` rewrote `pp_light_.seq` in place
  with registration data and printed per-frame FWHM and roundness, then "Total: 4 failed, 36 registered."
- `seqapplyreg sequencename [-prefix=] [-scale=] [-layer=] [-framing=current|min|max|cog] [-interp=] [-noclamp]
  [-drizzle ...] [-filter-fwhm=] [-filter-wfwhm=] [-filter-round=] [-filter-bkg=] [-filter-nbstars=]
  [-filter-quality=] [-filter-incl[uded]]`. Writes registered images with prefix `r_` (default). **The prefix is put
  in front of the sequence name** (`-prefix=r80_` on `light_` gave `r80_light_.seq`). Frames with no registration
  are always skipped ("Some images were not registered, excluding them").
- `stack seqname rej|mean [type] [sigma_low sigma_high] [-nonorm | -norm=add|mul|addscale|mulscale] [-fastnorm]
  [-weight={noise|wfwhm|nbstars|nbstack}] [-feather=] [-rgb_equal] [-output_norm] [-out=name] [-maximize]
  [-upscale] [-32b] [-rejmap[s]]`. Rejection letters: n p s m w l g a (none, percentile, sigma, median,
  winsorized, linear fit, generalised ESD, MAD); winsorized is the default when the letter is omitted and the
  two sigmas are mandatory unless `n`. Default normalisation is additive-with-scale. `-out=` sets the result
  name (otherwise `<sequence>_stacked.fit`). **Probe:** `stack r_pp_light rej w 3 3 -norm=addscale -output_norm
  -rgb_equal -out=result_coach` wrote `result_coach.fit` with `STACKCNT` = frames stacked, `LIVETIME` = frames x
  `EXPTIME`, `PROGRAM='Siril 1.4.5'`, 3 layers, and a HISTORY line "mean stacking with winsorized sigma clipping
  rejection (low=3.000 high=3.000), additive+scaling normalized input, normalized output, no image weighting,
  equalized RGB" — the same wording as the 1.4.4 tutorial stack in section 2. `stack` accepts the same `-filter-*`
  options as `seqapplyreg`.
- Single-image commands need an image loaded first: `load name`, then `subsky { -rbf | degree } [-dither]
  [-samples=20] [-tolerance=1.0] [-smooth=0.5] [-existing]`, `autostretch [-linked] [shadowsclip [targetbg]]`
  (defaults -2.8 and 0.25; the docs warn that unlinked stretching after colour calibration alters white balance),
  `save name` (writes `name.fit`), `savetif name [-astro] [-deflate]`, `close`. **Probe:** `load` + `subsky 1` +
  `autostretch` + `save` ran clean on the probe stack.
- `pcc [-limitmag=] [-catalog=apass|localgaia|gaia|nomad] [-bgtol=lo,hi]` and `spcc [-limitmag=]
  [-monosensor=|-oscsensor= ...] [-whiteref=] [-narrowband ...] [-bgtol=] [-atmos ...]` both need a **plate-solved**
  image. **Probe:** `pcc` on an unsolved image fails with "command is only for plate solved images" and the script
  aborts. `platesolve [-force] [centre coords] [-focal=] [-pixelsize=] ...` is the preceding step. SPCC sensor, filter
  and white-reference names must match the SPCC tool's lists exactly (`spcc_list` prints them); Gaia DR3 is always
  the catalogue. PCC defaults to NOMAD. Both therefore depend on the user's catalogues and on a successful solve;
  the coach advises, it cannot promise.
- `starnet [-stretch] [-upscale] [-stride=] [-nostarmask]` calls the separately installed StarNet CLI (path set in
  Siril's preferences); it is not tested here.

### Frame filters (`-filter-*`) and the percentage rule

This section describes Siril's own filter semantics. The coach offers and generates only roundness and weighted-FWHM
filters (the plan's filter enum is `none`/`round`/`wfwhm`); it never offers or uses a quality filter, and `quality`
is parsed into `RegData` but never compared.

Each filter value is one of three forms: a literal limit (roundness and quality 0 to 1, other properties in their
own units), `N%` for the best N percent, or `Nk` for a k-sigma limit. Literal and percent for the **same**
property together are an error; different properties combine with AND (probe: wfwhm 90 % and round 80 % kept 32
frames, the intersection of 32 and 33). Comparisons: roundness `>=`, FWHM and weighted FWHM `<=`, background
`<=`, star count `>=`. A frame with zero for the property never passes. Source:
<https://gitlab.com/free-astro/siril/-/blob/1.4.5/src/core/sequence_filtering.c>.

**Percentage rule (read in the source, confirmed by probe).** Let N be the number of frames in the sequence being
filtered (aligned or not) and sort the property across all N frames, putting unaligned frames at the "worst" end.

- Lower-is-better (FWHM, wFWHM, background): if any frame is unaligned, only the n aligned frames count (a warning
  is printed); threshold = sorted[floor(p x (n-1) / 100)]; kept = aligned frames with value <= threshold.
- Higher-is-better (roundness, star count, quality): the sorted list **includes** the unaligned frames (they sort
  first as zero), so threshold = sorted[floor((100-p) x (N-1) / 100)] with N the full frame count.
  **Consequence:** with unaligned frames present, `-filter-round=80%` keeps *more* than 80 % of the aligned frames.
  Probe: N = 40, 36 aligned: threshold index floor(20 x 39 / 100) = 7, the 4th-lowest aligned roundness, kept 33
  of 36 (92 %). Literal `-filter-round=0.8` kept 28; `-filter-wfwhm=50%` (n = 36, index floor(50 x 35 / 100) = 17)
  kept 18 of 36. The plan's selection options must predict counts with this rule, and the step text must not call
  it "the best 80 %" when frames are unaligned.
- Ties at the threshold are all kept.

### `.seq` format (version 6, written by 1.4.5)

Source: <https://gitlab.com/free-astro/siril/-/blob/1.4.5/src/io/seqfile.c>; `CURRENT_SEQFILE_VERSION` is 6 there
and the probe wrote 6. Versions 0 to 5 are older layouts the same reader still accepts; the coach accepts **only
6** (`SUPPORTED_SEQ_VERSIONS = {6}` stands).

- Two `#` comment lines first.
- `S 'name' start nb_images nb_selected fixed_len reference_image version variable_size fz_flag drizzle`: ten
  fields. `start` is the first file number (1 for converted sequences); **`reference_image` is a 0-based index**
  into the image list, not a file number; `version` is 6.
- `L <nb_layers>`: `-1` in a freshly converted sequence (not yet loaded), `3` once debayered (`pp_`, `r_`).
- `I <filenum> <incl>` per image, in sequence order (`I <filenum> <incl> <w>,<h>` only when `variable_size` is 1).
  `filenum` is the number in the file name (`light_00007.fit` is 7); `incl` is 1 or 0 (selected or not).
  Optional `T<S|A|F>` line for SER, film or FITS-sequence containers; none for ordinary FITS sequences.
- Registration, one line **per image per layer, for every image**, in sequence order:
  `R<layer> fwhm weighted_fwhm roundness quality background number_of_stars H h00 h01 h02 h10 h11 h12 h20 h21 h22`
  (`R*` instead of a digit for CFA registration of a mosaic SER). `<layer>` is a digit. **Probe: for debayered
  colour sequences the data is on `R1` (the green layer, where Siril detects stars), not `R0`**; a sequence that
  was registered before debayering would use `R0`. The parser must take whichever single `R<digit>` layer is
  present (prefer `R1` if several). The first value is FWHM in pixels; `quality` was 0 in every probe and is never compared or used.
  **Background units follow the image data:** about 1009 for the 16-bit-integer probe frames (ADU) but 0.0154 for
  the debayered 32-bit float frames (0 to 1 scale). Label the report's background as "Siril units, relative"
  and compare only within one sequence.
  Name mapping, Siril's printed/source names to `RegData`: `fwhm`->`fwhm`, `weighted_fwhm`->`wfwhm`,
  `roundness`->`roundness`, `quality`->`quality`, `background` (`background_lvl` in source)->`background`,
  `number_of_stars`->`stars`.
- **Unaligned frame:** `R1 0 0 0 0 0 0 H 0 0 0 0 0 0 0 0 0` (same with `R0` when the data layer is 0; all zero, including the matrix) together with `I <n> 0`
  (probe: all four blank frames; source: failed frames keep the zeroed registration record and are marked
  unselected). Siril's own tests for "has data" are `fwhm > 0` or `roundness > 0` per property. A *reference*
  frame has an identity matrix and real statistics.
- `M<layer>-<index> ...` statistics lines (0-based image index) and `D*`/`O*` distortion and overlap cards may be
  present; the coach ignores them.
- **The kept (`r_`) sequence preserves order and original file numbers.** `seqapplyreg` writes the filtered frames in
  input order (gaps are closed in order), copies each frame's FWHM, weighted FWHM, roundness, background and star
  count unchanged, sets the matrix to identity, and copies `filenum` into its `I` lines
  (probe: all three filtered sequences had strictly increasing `filenum`s and statistics equal to the source
  sequence's for the same `filenum`). Its `S` line has its own count and `reference_image` index. So the exact
  mapping from kept frames to the registration sequence is **by `filenum`**, and it can be checked: every kept
  `filenum` must exist in the registration sequence and the five copied statistics (`fwhm`, `weighted_fwhm`, `roundness`, `background`, `number_of_stars`; compare the
  printed text) must match; otherwise the kept sequence is stale. `quality` is **not** in that set: the `r_` writer
  (`apply_reg_image_hook` in `applyreg.c`, the block that assigns `fwhm`, `weighted_fwhm`, `roundness`,
  `background_lvl`, `number_of_stars` and `H`) has no assignment for it, so it stays at its zero-initialised value
  (observed 0 in probes); it is not compared.
- Conversion index = `filenum` = the number in the `light_conversion.txt` destination name; calibration
  (`pp_`) and registration keep it (probe).

### Pinned dependency

`photutils==3.0.0` (latest release, BSD-3-Clause per its package metadata) installs with numpy 2.4.6 and astropy
8.0.2; it pulls in `scipy` 1.17.1, which is pinned too. `photutils.psf.fit_fwhm` and
`photutils.detection.DAOStarFinder` both exist in 3.0.0 (checked by import). Signatures in 3.0.0:
`fit_fwhm(data, *, xypos=None, fwhm=None, fit_shape=None, mask=None, error=None)`; `DAOStarFinder(threshold, fwhm,
ratio=1.0, theta=0.0, sigma_radius=1.5, ..., exclude_border=False, n_brightest=None, peak_max=None, ...,
sharpness_range=(0.2, 1.0), roundness_range=(-1.0, 1.0))` (the old `sharplo/sharphi/roundlo/roundhi` arguments are
deprecated). Full backend suite after the pin: 232 passed, 7 skipped.

### Not verified here

`starnet`, `platesolve`, `pcc` and `spcc` success paths (they need StarNet, catalogues and a solvable image); the
real Bubble Nebula folder was not touched in this task (script validation on it is Task 8 step 5); the 1.4.5
reading of `ROWORDER` for real Seestar frames (the probe reported "top-down from settings").
