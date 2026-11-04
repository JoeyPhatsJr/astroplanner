# Processing Coach (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A step-by-step Siril processing coach for one AstroLog night of Seestar S30 frames: a night report built from Siril's own `.seq` files, recommendations whose reasons come from measured facts, generated Siril scripts, and a Seestar-vs-Siril comparison.

**Architecture:** New backend package `app/processing/` (pure parsers and rule functions + one FastAPI router + one table `processing_runs`), mirroring `app/astrolog/`. The browser reads only small text files (`.seq`, `*_conversion.txt`) from a picked night folder and posts their text; the backend parses, matches frames to AstroLog `CaptureFrame`s by basename, and returns ready-to-render steps. Finished stacks are uploaded to the local backend, measured in memory (numpy + photutils), and only previews and numbers are stored. Frontend adds one lazy page (`/astrolog/process/:captureSetId`) with a step rail, as in the approved mockup.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic, Astropy, numpy, photutils (new, BSD-3), zoneinfo (backend); React 19, TanStack Query, Recharts 3 (lazy), Vitest, Playwright (frontend); Siril 1.4.5 `siril-cli` for local validation only.

**Spec:** `docs/superpowers/specs/2026-11-03-processing-coach-design.md` (read it first). **Mockups:** `docs/superpowers/mockups/2026-11-03-processing-coach/processing-guide.html` (option B) and `compare.html`.

## Global Constraints

- CLAUDE.md non-negotiables and ROADMAP standing rules: no fabricated data, explicit loading/error/empty states, no dead buttons, accessible labels, responsive, night vision (no white/blue), no claimed tests that were not run.
- Phase 1–3 suites stay green and unchanged (baseline on `main` 2026-11-03: **232 backend passed / 7 skipped, 83 unit, 16 e2e**). Never edit an existing test's assertions to make it pass.
- **Raw light-frame pixels are never read** by browser or backend. The browser reads the text of only `<subfolder>/*.seq` and `<subfolder>/*_conversion.txt` directly inside a first-level subfolder of the picked night folder, each ≤ 5 MB; every other file is seen by name only.
- **Absolute paths are never stored or returned**: `light_conversion.txt` is reduced to basenames on the backend before anything is saved.
- **Header coordinates are never stored or returned** (`SITELAT`, `SITELONG`, and any `*LAT*`/`*LONG*` key) — Phase 2 rule.
- Stacks (never raws) may be uploaded to the local backend; pixels are measured in memory and **not stored**; only preview/thumb JPEGs (no metadata) and numbers are stored.
- Every piece of advice carries `basis ∈ {"measured","siril-docs","tutorial-default","taste"}` and `heuristic: bool`; `siril-docs` requires a `source_url`. No "score", no "winner".
- Times: UTC internally; display in the night location's IANA timezone (`TargetNight.timezone`); never parse the local-time file names for time.
- Coach scripts write only into `process-coach/` (constant `COACH_DIR`) next to `lights/`; they never write into an existing `process/`.
- Siril target version: `SIRIL_TARGET = "1.4.5"`. Supported `.seq` versions: `SUPPORTED_SEQ_VERSIONS = {6}` (confirmed in Task 1, spec §2a: Siril 1.4.5 writes version 6).
- Migration `0005_processing_runs` (hand-written, SQLite + Postgres; `test_migrations.py` ORM-vs-migrated check must pass). Note: branch `aavso-live-layer` also has a `0005`; it is not to be merged.
- Siril is GPL-3.0: write scripts and read its output files; never copy Siril source or documentation text. StarNet: mention and link only.
- Real data (FITS, `.seq`, conversion files, anything under `~/Astrophotography`) is never committed. Tests use synthetic fixtures; real-data checks live in `test_processing_real_data.py`, skipped unless `ASTROPLANNER_REAL_NIGHT_DIR` is set.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The picked folder isn't this night** (another target's run, or a folder whose basenames don't match the capture set) → if fewer than 50 % of the registration sequence's frames match this capture set's `CaptureFrame.source_filename`, the upload is rejected with "This Siril folder doesn't look like this night's frames (N of M match)"; nothing is saved. Test in Task 5.
2. **A stale kept-sequence** (Siril re-run in the same folder, `r_` sequence from an older run) → the `filenum`-based kept mapping fails its statistics check, the report shows "in stack: unknown" with the reason, never a wrong count. Test in Task 4.
3. **A night that crosses the DST change** (2026-11-01, America/New_York) → bins are ordered by UTC, labelled in local time, and the repeated 01:00–02:00 hour appears twice with distinct UTC starts. Test in Task 5.
4. **A Seestar stack that is a 2-D Bayer image or 16-bit integer with BZERO** → measured after 2×2 super-pixel debayer (FWHM reported in original pixels), labelled; never crashes or treats Bayer mosaic as noise. Test in Task 9.
5. **Merging targets ("This is …"/Unsorted) when a coach run exists** → the run moves with its capture set; if both merged capture sets have runs, the merge returns 409 and changes nothing. Test in Task 2.

---

### Task 1: Gate G1 — verify Siril 1.4.5 facts (no product code)

**Files:**
- Modify: `docs/superpowers/specs/2026-11-03-processing-coach-design.md` (append "§2a Recon: Siril 1.4.5 (G1)")
- Create: `docs/PROCESSING.md` (skeleton: "Sources" section with every URL read)
- Modify: `backend/requirements.txt` (add `photutils==<latest release that installs with numpy 2.4.6 / astropy 8.0.2>`), `backend/app/data/ATTRIBUTION.md` (photutils BSD-3)

- [ ] **Step 1:** Confirm `/Applications/Siril.app/Contents/MacOS/siril-cli --version` prints `siril 1.4.5`. If it still prints 1.4.4, stop and ask the developer to upgrade (spec G1).
- [ ] **Step 2:** From Siril's official documentation (siril.readthedocs.io, the 1.4 command reference) record, with URLs, the exact syntax and options for: `requires`, `cd`, `convert` (incl. `-out=`), `calibrate`/preprocess with `-debayer` and `-cfa`/`-equalize_cfa`, `register` (incl. `-2pass`), `seqapplyreg` (incl. `-filter-round=`, `-filter-wfwhm=`, and whether a `k%` form exists and how the kept count is rounded), `stack` (`rej w 3 3`, `-norm=addscale`, `-output_norm`, `-rgb_equal`, `-out=`), background extraction (`subsky`), colour calibration (`spcc` and/or `pcc`, and what they need: plate solve), stretch (`autostretch`), `starnet`, and `close`.
- [ ] **Step 3:** From Siril's source for 1.4.5 (`src/io/seqfile.c` or current equivalent) **read, don't copy**, and record: the `.seq` version written, the field order of `S`, `I`, `R<layer>` lines, how a frame with no registration is written, and whether the `r_` sequence preserves the original order of kept frames. Update `SUPPORTED_SEQ_VERSIONS` in the plan text if it differs from `{6}`.
- [ ] **Step 4:** `backend/.venv/bin/pip install photutils==<ver>` and `python -c "import photutils; print(photutils.__version__)"`; pin it. Run the full backend suite: still `232 passed, 7 skipped`.
- [ ] **Step 5:** If any command differs from the spec's assumptions, change this plan's Task 6/8 text accordingly in the same commit and say so in the commit body.
- [ ] **Step 6: Commit** `docs(processing): G1 — verify Siril 1.4.5 commands and .seq format; pin photutils`

### Task 2: Run model, migration and run API

**Files:**
- Create: `backend/app/processing/__init__.py`, `models.py`, `routes.py`, `steps.py`, `rules.py`
- Create: `backend/migrations/versions/0005_processing_runs.py`
- Modify: `backend/app/main.py` (include router), `backend/app/astrolog/library.py` (`target_page` nights gain `capture_set_id`; `_move_records` carries runs), `frontend/src/api/astrolog.ts` (`TargetNight.capture_set_id: string`)
- Test: `backend/tests/test_processing_runs.py`, `backend/tests/test_migrations.py` (no assertion edits; it picks up the new table)

**Interfaces:**
- Produces: table `processing_runs` (`id` str PK uuid, `capture_set_id` FK `capture_sets.id` RESTRICT **unique**, `siril_version` str null, `step_states` JSON default `{}`, `choices` JSON default `{}`, `folder` JSON null, `frame_stats` JSON null, `comparison` JSON default `{}`, `created_at`, `updated_at`).
- Produces: `StepId = Literal["report","convert","align","select","stack","background","colour","stretch","finish","compare"]`, `STEP_ORDER: tuple[StepId, ...]` in that order (titles from the mockup rail: "Night report", "Convert & debayer", "Align", "Choose frames", "Stack", "Background", "Colour", "Stretch", "Stars & finish", "Compare").
- Produces (`rules.py`): `Basis`, `@dataclass(frozen=True) Advice(rule_id: str, setting: str, why: str, basis: Basis, heuristic: bool, source_url: str | None)`, `@dataclass(frozen=True) Facts(bayer_pattern: str | None, frame_count: int, exptime_s: float | None, report: "Report | None" = None, siril_stack: "StackMeasurement | None" = None, seestar_stack: "StackMeasurement | None" = None)`, `Rule(id, step: StepId, basis, heuristic, source_url, applies: Callable[[Facts], bool], advise: Callable[[Facts], Advice])`, `RULES: tuple[Rule, ...]`, `advice_for(step: StepId, facts: Facts) -> list[Advice]`.
- Produces (`steps.py`): `@dataclass StepView(id: StepId, n: int, title: str, does: str, advice: list[Advice], gui: str, command: str | None, expect: str | None, state: Literal["todo","done"], blocked: str | None)`, `build_steps(facts: Facts, step_states: dict[str, str]) -> list[StepView]`.
- Produces API (prefix `/api/processing`): `POST /runs {capture_set_id}` → `RunOut` (get-or-create; 404 unknown set; 422 `"The coach supports Seestar S30 FITS nights only."` unless `capture_set.device` casefolds to `seestar s30`); `GET /runs/{run_id}` → `RunOut`; `PATCH /runs/{run_id} {step_states?: dict[StepId, "todo"|"done"], choices?: dict}` → `RunOut`. `RunOut = {id, capture_set_id, target: {id, name}, night: {session_id, night_date, timezone}, frames: int, exptime_s, steps: list[StepView], report: Report | null, selection: list[SelectionOption], comparison: ComparisonOut, siril_target: "1.4.5"}` (fields filled by later tasks are `null`/`[]` here).

- [ ] **Step 1: Failing tests** in `test_processing_runs.py`, using `astrolog_fixtures.seestar_sub_header` to import a 3-frame S30 night through `/api/astrolog/import/commit`:
  - `test_create_run_is_idempotent`: two `POST /runs` with the same `capture_set_id` return the same `id`.
  - `test_run_rejects_non_seestar`: a Canon capture set → 422 with the exact message above.
  - `test_run_steps_in_mockup_order`: `[s["id"] for s in run["steps"]] == list(STEP_ORDER)`; `steps[0]["blocked"]` contains `"first script"` (no Siril folder yet).
  - `test_patch_step_state_persists`: PATCH `{"step_states": {"convert": "done"}}` then GET → `steps[1]["state"] == "done"`; an unknown step id → 422.
  - `test_every_rule_has_basis`: for each `r in RULES`: `r.basis in get_args(Basis)`; `r.basis == "siril-docs"` ⇒ `r.source_url.startswith("https://")`.
  - `test_convert_advice_uses_bayer_from_header`: `advice_for("convert", Facts(bayer_pattern="GRBG", frame_count=3, exptime_s=10))[0].setting` contains `"GRBG"` and `basis == "measured"`; with `bayer_pattern=None` the basis is `"siril-docs"`.
  - `test_import_stores_bayer_pattern`: importing `seestar_sub_header(BAYERPAT="GRBG")` stores `"GRBG"`; `BAYERPAT="junk!"` stores `None`.
  - `test_target_nights_carry_capture_set_id`: `GET /api/astrolog/targets/{id}` → `nights[0]["capture_set_id"]` equals the run's `capture_set_id`.
  - `test_merge_moves_run` and `test_merge_conflict_409`: Review Focus 5 (use the existing "This is …"/unsorted merge endpoints the Phase 3 tests use).
- [ ] **Step 2:** Run `cd backend && .venv/bin/python -m pytest tests/test_processing_runs.py -q` → FAIL (module missing).
- [ ] **Step 3:** Implement models, migration (`revision = "0005_processing_runs"`, `down_revision = "0004_capture_exif"`; it also adds nullable `capture_frames.bayer_pattern String(8)`), routes, and the initial rules. Colour pattern: add `bayer_pattern: str | None` to `headers.FitsInfo` (from `BAYERPAT`, stripped, only values matching `^[RGB]{4}$`) and store it on new `CaptureFrame`s at import; nothing is back-filled. `convert.debayer` rule: when the run's frames have one distinct non-null pattern → setting "Debayer with pattern {p} (from your frame headers)", basis `measured`; otherwise "Siril reads the pattern from each frame's `BAYERPAT` header", basis `siril-docs` with Task 1's URL. Copy for `does`/`gui`/`expect` in our own words from Task 1's recon. In `_move_records`, before deleting a merged-away capture set, re-point its run to `existing`, or raise the existing 409 error type if both have runs.
- [ ] **Step 4:** Run the new tests → PASS; run the full backend suite → `232 + new passed, 7 skipped`.
- [ ] **Step 5: Commit** `feat(processing): coach runs table, run API and step skeleton`

### Task 3: Coach page shell (first UI milestone)

**Files:**
- Create: `frontend/src/api/processing.ts`, `frontend/src/pages/ProcessingCoachPage.tsx`, `frontend/src/components/processing/CoachRail.tsx`, `StepPanel.tsx`, `AdviceList.tsx`, `frontend/src/components/processing/processing.test.tsx`
- Modify: `frontend/src/App.tsx` (lazy route `/astrolog/process/:captureSetId`), `frontend/src/pages/TargetLogPage.tsx` (button "Process this night" on nights whose `device` casefolds to `seestar s30`)

**Interfaces:**
- Consumes: Task 2 API and `RunOut`.
- Produces: TS types mirroring `RunOut`, `StepView`, `Advice`; hooks `useStartRun()` (mutation `POST /runs`), `useRun(runId)`, `usePatchRun(runId)`; query key `qk.processingRun(id)` added to `api/hooks.ts`.

- [ ] **Step 1: Failing Vitest** in `processing.test.tsx` (render with mocked fetch, as `astrolog.test.tsx` does):
  - rail lists the 10 titles in order; current step has `aria-current="step"`; done steps show "✓".
  - `AdviceList` renders each advice's basis as a visible label ("Measured", "Siril docs", "Tutorial default", "Your taste") and a "Heuristic" tag when `heuristic`; a `siril-docs` item links to `source_url`.
  - "Done, next step" PATCHes `{step_states: {<id>: "done"}}` and moves to the next step; "Back" moves back; on the last step "Done" is replaced by "Save to AstroLog" which PATCHes and links back to the target page.
  - blocked step shows `blocked` text instead of advice.
- [ ] **Step 2:** `cd frontend && npm test -- processing` → FAIL.
- [ ] **Step 3:** Implement following the mockup (`processing-guide.html` option B): rail left on ≥ 720 px, horizontal scroller on mobile; "Step n of 10" crumb; command in a `<pre>` with a copy button; theme tokens only (night vision works automatically). The page calls `useStartRun` with the route's `captureSetId`, then `useRun`.
- [ ] **Step 4:** `npm test` (all, 83 + new pass), `npm run typecheck`, `npm run build` → ok. Manual check in the dev server: TargetLog → Process this night → click through all 10 steps, desktop/mobile/night vision.
- [ ] **Step 5: Commit** `feat(processing): coach page, step rail and entry button`. **Tell the developer the clickable coach is ready to try.**

### Task 4: Siril output parsers (pure)

**Files:**
- Create: `backend/app/processing/seq.py`, `backend/tests/processing_fixtures.py`, `backend/tests/test_processing_seq.py`

**Interfaces:**
- Produces: `class SeqParseError(ValueError)`; `@dataclass(frozen=True) RegData(fwhm: float, wfwhm: float, roundness: float, quality: float, background: float, stars: int)`; `SeqImage(index: int, filenum: int, selected: bool, reg: RegData | None)` (`filenum` from the `I` line; `reg is None` ⇔ no `R` line **or** `fwhm == 0 and roundness == 0` (Siril's own "no data" test; unaligned frames are an all-zero `R` line); the data layer is whichever single `R<digit>` layer is present, `R1` preferred, since debayered colour sequences carry it on `R1`); `SeqFile(name: str, nb_images: int, nb_selected: int, reference: int, version: int, images: tuple[SeqImage, ...])` (`reference` is a **0-based index** into `images`, as in the `S` line); `parse_seq(text: str) -> SeqFile`; `parse_conversion(text: str) -> dict[int, str]` (`filenum` → **basename only**); `class KeptMappingError(ValueError)`; `kept_mask(reg: SeqFile, kept: SeqFile) -> list[bool]` (matched by `filenum`).
- Produces (fixtures): `synthetic_seq(name: str, rows: list[tuple[bool, RegData | None]], version: int = 6, reference: int = 0, layer: int = 1) -> str` and `synthetic_conversion(basenames: list[str], src_dir: str = "/private/sentinel/ZZ_PATH") -> str`.

- [ ] **Step 1: Failing tests:**
  - `test_parse_seq_header_and_rows`: a synthetic 4-image sequence → `nb_images == 4`, `nb_selected == 3`, `images[1].reg.roundness == 0.83`, `images[3].reg is None` for a zero `R` line.
  - `test_parse_seq_rejects_unknown_version`: version 7 → `SeqParseError` with message containing `"version 7"` and `"1.4.5"`.
  - `test_parse_seq_rejects_garbage`: non-Siril text → `SeqParseError("Not a Siril sequence file")`.
  - `test_conversion_keeps_basenames_only`: result values contain no `/` and no `"ZZ_PATH"`; `{1: "Light_NGC 7635_10.0s_LP_20260911-231147.fit", ...}` (names with spaces survive).
  - `test_kept_mask_by_filenum`: 6 aligned frames (file numbers 1..6), kept sequence = file numbers 1,3,4 with the same `fwhm`, `wfwhm`, `roundness`, `background`, `stars` (`quality` differs and is ignored) → `[True, False, True, True, False, False]`; frames with identical statistics in different positions still map correctly because the match is by `filenum`.
  - `test_kept_mask_stale_sequence`: a kept sequence containing a `filenum` absent from the registration sequence, or whose `fwhm`/`wfwhm`/`roundness`/`background`/`stars` differ for the same `filenum`, or whose `filenum`s are not increasing → `KeptMappingError` (Review Focus 2).
  - `test_unaligned_frame_is_all_zero_line`: an `R1 0 0 0 0 0 0 H 0 0 0 0 0 0 0 0 0` row with `I n 0` parses to `reg is None`, `selected False`; the same fixture with `layer=0` parses identically; a sequence with no `R` lines at all parses with every `reg is None`.
- [ ] **Step 2:** `pytest tests/test_processing_seq.py -q` → FAIL.
- [ ] **Step 3:** Implement per the field order recorded in Task 1 §2a. `kept_mask`: Siril's `seqapplyreg` writes kept frames in input order, keeps each frame's `filenum` in its `I` line and copies FWHM, weighted FWHM, roundness, background and star count unchanged (it does not copy `quality`, which stays at its zero default, and it sets the matrix to identity, so compare exactly `fwhm`, `wfwhm`, `roundness`, `background`, `stars`; spec §2a). Build `{filenum: RegData}` for the registration sequence; for each kept image require its `filenum` to exist, those five fields to be equal (parsed from the same printed text, exact equality), and `filenum`s strictly increasing; otherwise `KeptMappingError`. Never match by statistics alone.
- [ ] **Step 4:** Tests PASS.
- [ ] **Step 5: Commit** `feat(processing): parse Siril .seq and conversion files`

### Task 5: Night report and folder upload

**Files:**
- Create: `backend/app/processing/report.py`, `backend/tests/test_processing_report.py`, `backend/tests/test_processing_real_data.py`
- Modify: `backend/app/processing/routes.py`, `rules.py` (report-based rules), `backend/app/astronomy.py` (add `altitude_deg(ra_deg: float, dec_deg: float, lat_deg: float, lon_deg: float, utc_iso: list[str]) -> np.ndarray`, built on the existing `_altaz_frame`; target coordinates from `targets.lookup(catalog_target_id)` or the library target's own `ra_deg/dec_deg`; site from the session's `ObservingLocation`, used internally and never returned)

**Interfaces:**
- Consumes: Task 4 parsers; `CaptureFrame` rows of the run's capture set.
- Produces: `FrameStat(n: int, basename: str | None, utc: str | None, aligned: bool, kept: bool | None, fwhm, wfwhm, roundness, background, stars)` (stat fields `None` when not aligned); `FolderResult(run_dir: str, registration_seq: str, kept_seq: str | None, seq_version: int, frames: list[FrameStat], matched: int, kept_error: str | None, calibration_dirs: list[str])`; `build_folder(files: list[UploadedText], calibration_dirs: list[str], frame_times: dict[str, str]) -> FolderResult` where `UploadedText = {path: str, text: str}` with `path` relative like `process/pp_light_.seq`; `Report(totals: {captured, aligned, kept: int | None, captured_s, aligned_s, kept_s: float | None}, medians: {stars, fwhm, wfwhm, roundness}, ranges: {stars: [min,max]}, bins: list[Bin], findings: list[Finding], time_unknown: int)`; `Bin(start_utc: str, label_local: str, captured: int, aligned: int, kept: int | None)`; `Finding(id: str, title: str, detail: str, basis: Basis, heuristic: bool)`; `night_report(folder: FolderResult, exptime_s: float, tz: str | None, bin_minutes: int = 30) -> Report`.
- Produces API: `POST /runs/{id}/siril-folder {run_dir: str, files: list[UploadedText], calibration_dirs: list[str]}` → `RunOut` with `report`; stores `folder` (no paths beyond `run_dir` name, e.g. `"process"`) and `frame_stats`; errors 422 with the parser/matching message.
- Constants in `report.py`, each documented in `docs/PROCESSING.md` as heuristics: `MIN_MATCH_FRACTION = 0.5`, `LOW_STARS = 50`, `SPLIT_HIGH = 0.85`, `SPLIT_LOW = 0.60`.

- [ ] **Step 1: Failing tests** (synthetic 40-frame night built with `processing_fixtures`, frame times 2026-09-12T03:00Z + 15 s steps, tz `America/New_York`):
  - `test_report_totals`: captured 40, aligned 34, kept 26; `captured_s == 400.0`, `kept_s == 260.0`.
  - `test_registration_seq_choice`: given `light_.seq` (no R data), `pp_light_.seq` (R data) and `r_pp_light_.seq` → `registration_seq == "pp_light_"`, `kept_seq == "r_pp_light_"`; without `r_…` → `kept is None` for every frame and `totals.kept is None`.
  - `test_bins_local_labels`: first bin `label_local == "23:00"` (EDT), bins ordered by `start_utc`.
  - `test_bins_across_dst_end`: a night 2026-11-01 05:00Z–07:30Z → two bins labelled `"01:00"` with different `start_utc` (Review Focus 3).
  - `test_findings`: `not_aligned` ("6 frames couldn't be aligned"); `round_cut` when every dropped-after-aligning frame has roundness below every kept one ("…all had roundness below 0.74", value = midpoint rounded to 2 dp); `time_split` "Before 01:30, 50 % of frames reached the stack; from 01:30 on, 92 %" only when the split thresholds hold; `low_stars` (heuristic=True); `calibration` only when `calibration_dirs` non-empty.
  - `test_possible_cause_low_altitude`: when the target's altitude (app's own Astropy computation) is below `LOW_ALT_DEG = 30` for the low-keep bins, the `time_split` detail ends "Possible causes: the target was below 30° until HH:MM."; when it is not, no cause text appears. No other cause (cloud, dew, wind) is ever named. Causes never appear in `title`.
  - `test_altitude_deg_transit`: `astronomy.altitude_deg(ra, dec, lat, lon, [transit_utc])` ≈ `90 − |lat − dec|` within 0.1° (Polaris-free test star, Dec +61.36°, lat 40.09°).
  - `test_folder_not_this_night`: basenames matching 10 of 40 → 422 `"This Siril folder doesn't look like this night's frames (10 of 40 match)"`; run unchanged (Review Focus 1).
  - `test_stale_kept_reports_unknown`: kept mapping error → `totals.kept is None`, `folder.kept_error` contains "re-run", 200 response (Review Focus 2).
  - `test_no_paths_or_coords_stored`: after upload, `json.dumps(run row)` contains neither `"ZZ_PATH"` nor `"/"`-prefixed paths.
  - `test_processing_real_data.py` (skipped without `ASTROPLANNER_REAL_NIGHT_DIR`): reading `<dir>/process/*.seq` + conversion gives captured 1,015 / aligned 851 / kept 654, `round_cut` value 0.74, medians stars 44 and FWHM 2.25 (2 dp), and the split finding "Before 03:30 … 51 % … 91 %". Frame times come from the lights' FITS `DATE-OBS` read in the test (headers only).
- [ ] **Step 2:** `pytest tests/test_processing_report.py -q` → FAIL.
- [ ] **Step 3:** Implement. Registration seq = non-`r_` sequence with any `reg` and the most images; kept seq = `"r_" + registration name` if uploaded. Conversion index = `filenum` (the number in the destination name `light_00007.fit`, which Siril keeps through calibration and registration; confirmed in Task 1). `parse_conversion` therefore keys by that number, taken from the destination name, not by line position. Report background is labelled "Siril units, relative" because it is ADU for 16-bit sequences and 0 to 1 for debayered float ones (spec §2a). Binning with `zoneinfo`, bin starts floored in UTC to `bin_minutes`. Add report-based rules to `rules.py`: `align.two_pass` (applies when `median stars < LOW_STARS`; heuristic), `stack.rejection` (winsorized 3/3 when kept ≥ 30 frames; `siril-docs` URL from Task 1).
- [ ] **Step 4:** Tests PASS; run the real-data test locally: `ASTROPLANNER_REAL_NIGHT_DIR="$HOME/Astrophotography/Bubble Nebula" .venv/bin/python -m pytest tests/test_processing_real_data.py -q` → PASS (record in PROGRESS.md in Task 12).
- [ ] **Step 5: Commit** `feat(processing): night report from Siril sequence files`

### Task 6: Folder picker and night report UI (second UI milestone)

**Files:**
- Create: `frontend/src/lib/nightFolder.ts`, `frontend/src/lib/nightFolder.test.ts`, `frontend/src/components/processing/NightReport.tsx`, `FramesChart.tsx`, `FolderPicker.tsx`
- Modify: `frontend/src/components/processing/StepPanel.tsx` (step "report"), `processing.test.tsx`, `frontend/src/api/processing.ts` (`useUploadFolder(runId)`)

**Interfaces:**
- Produces: `readNightFolder(files: File[]): Promise<{runs: {runDir: string; files: {path: string; text: string}[]}[]; calibrationDirs: string[]; skipped: string[]}>` — groups by first-level subfolder containing `.seq` files; reads `.text()` **only** of `*.seq` / `*_conversion.txt` directly inside that subfolder and ≤ 5 MB; `calibrationDirs` = first-level directory names matching `/^(dark|flat|bias|offset)/i`.

- [ ] **Step 1: Failing tests:**
  - `nightFolder.test.ts`: a fake `File[]` with `webkitRelativePath` (`Bubble/lights/a.fit`, `Bubble/process/pp_light_.seq`, `Bubble/process/cache/x.lst`, `Bubble/process/light_conversion.txt`, `Bubble/process-coach/pp_light_.seq`, `Bubble/flats/f1.fit`) → two runs (`process`, `process-coach`), `calibrationDirs == ["flats"]`, and a spy shows `.text()` was called only on the three text files (acceptance 7); an 8 MB `.seq` is in `skipped`.
  - `processing.test.tsx`: report step renders totals "1,015 / 851 / 654"-style from a mocked report, the findings list, chart `role="img"` with an `aria-label` summarising bins; with two runs the picker asks which run to use; 422 error text is shown in an alert.
- [ ] **Step 2:** `npm test -- nightFolder processing` → FAIL.
- [ ] **Step 3:** Implement. Picker uses `<input type="file" webkitdirectory>` with a visible label "Choose the night folder (the one containing lights/)". Chart: stacked bars kept / aligned-dropped / not-aligned via lazy Recharts, colours from theme tokens (`--color-ice`, `--color-warn`, `--color-line`), as in the mockup. "Re-read folder" button re-runs the picker.
- [ ] **Step 4:** `npm test`, `npm run typecheck`, `npm run build` → ok. Manual: pick the real Bubble Nebula folder in the dev server; totals 1,015 / 851 / 654; night vision; mobile.
- [ ] **Step 5: Commit** `feat(processing): night folder picker and night report`. **Tell the developer the report works with their real folder.**

### Task 7: Frame-selection options

**Files:**
- Create: `backend/app/processing/selection.py`, `backend/tests/test_processing_selection.py`, `frontend/src/components/processing/SelectionStep.tsx`
- Modify: `routes.py` (`RunOut.selection`; `PATCH choices.selection` validated against option ids), `processing.test.tsx`

**Interfaces:**
- Produces: `SelectionOption(id: str, label: str, filter: Literal["none","round","wfwhm"], value: float | None, percent: int | None, kept: int, seconds: float, basis: Basis, heuristic: bool, note: str)`; `LastChoice(night_date: str, target_name: str, option_label: str, kept: int)`; `selection_options(frames: list[FrameStat], exptime_s: float, previous_round_cut: float | None, last_time: LastChoice | None) -> list[SelectionOption]`; constant `KEEP_PERCENT = 80` (heuristic). `last_time` = the most recent *other* run on a capture set with the same `device` whose `choices.selection` is set (spec §7.4); it is shown as a note above the options ("Last time (Sep 11, NGC 7635) you kept 654 frames: roundness ≥ 0.74"), never pre-selected.
- Options in order: `all` ("Keep every aligned frame"); `previous` (only when a `round_cut` finding exists: "Same as your last run: roundness ≥ {v}", basis measured); `round{KEEP_PERCENT}`; `wfwhm{KEEP_PERCENT}`. `kept` for percent options uses Siril's percentage rule recorded in Task 1 (spec §2a): with N = all frames in the registration sequence (aligned or not) and n = aligned frames, roundness `p%` has threshold `sorted_ascending_over_N[floor((100-p)(N-1)/100)]` (unaligned count as zeros, so more than `p%` of the aligned frames are kept when any are unaligned), FWHM-type `p%` has threshold `sorted_ascending_over_aligned[floor(p(n-1)/100)]`; kept = aligned frames passing `>=`/`<=` the threshold, ties kept. Option notes say "Siril's percentage, counted over all N frames" when `N != n`.

- [ ] **Step 1: Failing tests:** the 40-frame fixture → `all.kept == 34`, `seconds == 340.0`; `previous.value == 0.74` and `previous.kept == 26`; `round80.kept` equals the §2a rule for the fixture (N = 40, n = 34: threshold index `floor(20*39/100) = 7`, i.e. the 2nd-lowest aligned roundness; assert the exact value computed by hand in the test, e.g. 33 when roundness values are distinct) and is greater than 80 % of 34; options with identical `kept` and filter are de-duplicated; `PATCH {"choices": {"selection": "nope"}}` → 422; a second night with the same device shows the first night's `LastChoice` note and no option is pre-selected; a different device shows none. Vitest: two-to-four option cards ("Sharper"/"Smoother" wording from the mockup for `previous`/`all`), choosing one PATCHes and marks it selected; counts and `h m` durations rendered via `lib/format.ts`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; full suites.
- [ ] **Step 5: Commit** `feat(processing): frame-selection trade-off`

### Task 8: Siril scripts

**Files:**
- Create: `backend/app/processing/scripts.py`, `backend/tests/test_processing_scripts.py`, `backend/tests/golden/prepare.ssf`, `backend/tests/golden/stack_round.ssf`, `frontend/src/components/processing/ScriptButton.tsx`
- Modify: `routes.py` (`GET /runs/{id}/scripts/{which}`, `which ∈ {"prepare","stack"}` → `text/plain; charset=utf-8`, `Content-Disposition: attachment; filename="astroplanner-<which>.ssf"`; `stack` → 409 `"Choose which frames to keep first."` until `choices.selection` set), `StepPanel.tsx`

**Interfaces:**
- Produces: `COACH_DIR = "process-coach"`, `prepare_script(facts: Facts) -> str` (convert → calibrate/debayer → register all, **no filtering**, all output in `COACH_DIR`), `stack_script(option: SelectionOption, facts: Facts) -> str` (`seqapplyreg` with the option's filter, `stack` with the chosen rejection, output `<COACH_DIR>/result_coach`). Every command line is preceded by a `# ` comment line explaining why. First line `requires 1.4.5` (mandatory: without it Siril runs nothing and still reports success; spec §2a). Script assumes Siril's working directory is the night folder; the step text says how to set it (`siril-cli -d <night folder> -s file.ssf`, or Siril's Scripts menu). Verified shape of `prepare_script` (all names relative; `lights` is the folder holding the FITS frames): `requires 1.4.5`, `cd lights`, `convert light -out=../process-coach`, `cd ../process-coach`, `calibrate light -debayer` (no flats/darks: runs fine and writes `pp_light_`), `register pp_light -2pass` (computes registration and writes no images), `close`. `prepare_script` does **not** run `seqapplyreg` (it would write a second full set of 32-bit frames only to be filtered again). `stack_script` shape: `requires 1.4.5`, `cd process-coach`, `seqapplyreg pp_light <filters>` (writes `r_pp_light_`; unaligned frames are skipped automatically), `stack r_pp_light rej w 3 3 -norm=addscale -output_norm -rgb_equal -out=result_coach`, `close`. Filter syntax `-filter-round=0.74` (literal, `>=`) or `-filter-round=80%`; several filters combine with AND. If the lights folder is not named `lights`, the folder name is a parameter in `Facts` (default `lights`). Use the default `r_` prefix so the report's `r_<name>` lookup holds.
- Disk notice: `disk_estimate_bytes(frame_count: int, width: int = 1080, height: int = 1920) -> int`, shown on the convert step before download. Verified by probe (spec §2a): `convert` symlinks FITS (about 140 bytes each); `calibrate -debayer` writes one 3-layer float32 file per frame of `width*height*3*4 + 2880` bytes (1,442,880 for 400x300); `seqapplyreg` writes the same size per kept frame. So the estimate is `frame_count*(w*h*12+2880)` for the `pp_` set plus `kept*(w*h*12+2880)` for the `r_` set; the prepare script alone costs the first term, and the stack script adds the second (shown on the stack step). Compare with the developer's 39 GB `process/` in Step 5.

- [ ] **Step 1: Failing tests:** output equals the golden files byte-for-byte for fixed `Facts`; `"-filter" not in prepare_script(...)`; no line contains `/Users`, `~` or an absolute path; every non-comment, non-blank line is preceded by a comment; `stack_script(round option)` contains the option's value; `GET …/scripts/stack` before choosing → 409; downloaded filename header exact.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with Task 1's verified syntax. **Step 4:** Tests PASS.
- [ ] **Step 5: Local Siril validation (developer approved, spec R1):** `df -h ~` shows ≥ 50 GB free; run `siril-cli -d "$HOME/Astrophotography/Bubble Nebula" -s astroplanner-prepare.ssf`, then the stack script with the `previous` option. Check: `lights/` and `process/` unchanged (`ls -la` + file counts before/after), the coach folder's sequences parse, the report built from `process-coach/` matches its `.seq` files (independent check: count `I` lines/`R` lines with `awk`), and kept count equals `previous.kept` (acceptance 1–3). Record numbers, disk used, and duration for PROGRESS.md. **Do not delete `process-coach/`; ask the developer.**
- [ ] **Step 6: Commit** `feat(processing): generated Siril scripts with reasons`

### Task 9: Stack measurement (pure)

**Files:**
- Create: `backend/app/processing/measure.py`, `backend/tests/test_processing_measure.py`

**Interfaces:**
- Produces: `StackMeasurement(width: int, height: int, channels: int, bayer: str | None, stack_count: int | None, livetime_s: float | None, exptime_s: float | None, program: str | None, star_fwhm_px: float | None, stars_measured: int, noise_frac: float, gradient_frac: float, gradient_residual_frac: float, bg_rgb_ratio: tuple[float, float, float] | None, method: str)` (`method = "coach-measure-1"`); `measure_stack(data: bytes, filename: str) -> tuple[StackMeasurement, bytes, bytes]` (measurement, preview JPEG, thumb JPEG); `coach_stretch(a: np.ndarray) -> np.ndarray` (H,W,C float → uint8; per channel: median/MAD black point at median − 2.8·σ, midtones transfer so the median maps to 0.25 — the stretch used for the mockup preview).
- Method (documented in `docs/PROCESSING.md`): luminance = mean of channels (after 2×2 super-pixel debayer if 2-D with `BAYERPAT`); `scale = P99.5 − median`; `noise_frac = 1.4826·MAD(background pixels) / scale` (background = pixels below the 60th percentile); `gradient_frac` = (max − min) of a plane fitted to 8×8 tile medians / `scale`; `gradient_residual_frac` = robust spread of tile medians after the plane / `scale`; FWHM = median of `photutils.psf.fit_fwhm` over ≤ 200 isolated, unsaturated `DAOStarFinder` detections (5σ), ×2 when super-pixelled; `bg_rgb_ratio` = background medians per channel / their mean. Headers: `STACKCNT`, `LIVETIME`, `EXPTIME`, `PROGRAM`, `BAYERPAT` only; coordinates never read into the result.

- [ ] **Step 1: Failing tests** with synthetic images (numpy, seeded): Gaussian stars FWHM 3.0 px on flat background + noise → `star_fwhm_px` within 3.0 ± 0.15; `noise_frac` unchanged (±2 %) when the image is multiplied by 7 and offset by 500 (scale-free); doubling the noise doubles `noise_frac` (±10 %); a linear ramp gives `gradient_frac` > 0.1 and `gradient_residual_frac` < 0.02; green-biased background → `bg_rgb_ratio[1] > 1.05`; a 2-D `BAYERPAT='GRBG'` uint16 image with `BZERO=32768` measures without error and with `bayer == "GRBG"` (Review Focus 4); a header with `SITELAT` sentinel → `"SITELAT"` and its value absent from `repr(result)`; preview JPEGs have no EXIF.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS; local check on the real Siril stack (`NGC_7635_654x10sec_…fit`): `stack_count == 654`, `livetime_s == 6540`, FWHM within Siril's per-frame median range (record value).
- [ ] **Step 5: Commit** `feat(processing): measure finished stacks with one documented method`

### Task 10: Stack uploads and stack-based advice (steps 6–9)

**Files:**
- Modify: `routes.py` (`POST /runs/{id}/stacks/{side}` multipart, `side ∈ {"siril","seestar"}`, FITS only, size ≤ `app.state.max_upload_bytes`; stores preview/thumb via `app.state.storage` and `comparison[side + "_stack"] = {measurement, preview_key, thumb_key, source_filename}`; `GET /runs/{id}/images/{key}`), `rules.py`, `steps.py`
- Test: `backend/tests/test_processing_stacks.py`

**Interfaces:**
- Produces rules (all `basis="measured"`, thresholds `heuristic=True`, constants documented): `background.degree` (degree 1 when `gradient_residual_frac` < `RESIDUAL_FOR_DEGREE2 = 0.01`, else 2; "why" quotes `gradient_frac` as a percent of the image's brightness range); `colour.cast` (names the strongest background channel when `max(bg_rgb_ratio) > 1.05`, says colour calibration corrects it; SPCC needs plate solving per Task 1); `stretch.start` (`basis="taste"`: "start from autostretch"). Without a Siril stack these steps show `tutorial-default`/`taste` advice and a prompt "Add your Siril stack to get advice for this night".
- [ ] **Step 1: Failing tests:** upload synthetic ramp stack as `siril` → `steps[background].advice[0].basis == "measured"`, setting mentions degree 1; residual-heavy synthetic → degree 2; no stack → basis `tutorial-default`; a JPEG to `/stacks/siril` → 422 "Stacks must be FITS files"; the stored row contains no pixel arrays and no header coordinates; storage holds exactly 2 new files per upload; re-upload replaces (old keys deleted).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS; full suite.
- [ ] **Step 5: Commit** `feat(processing): stack uploads and measured advice for background, colour and stretch`

### Task 11: Compare step

**Files:**
- Create: `frontend/src/components/processing/CompareStep.tsx`
- Modify: `routes.py` (`POST /runs/{id}/pictures/seestar` multipart JPEG/PNG/TIFF via `previews.make_previews`; EXIF `Software` → `edited_by`; `PATCH comparison.seestar_picture.edited: bool | null`), `RunOut.comparison`, `processing.test.tsx`
- Test: `backend/tests/test_processing_compare.py`

**Interfaces:**
- Produces: `ComparisonOut = {mode_available: {"pictures": bool, "stacks": bool}, seestar_picture: {preview_url, source_filename, width, height, edited: bool | null, edited_by: str | null} | null, final_picture: <the target's current FinalImage preview> | null, siril_stack: {preview_url, measurement} | null, seestar_stack: {preview_url, measurement} | null}`.
- UI as `compare.html`: segmented control "Final pictures" / "Stacks (measured)"; pictures mode shows **no numbers** except source/edited/size; stacks mode shows both previews (both made with `coach_stretch`) and the same rows for each side (frames, total exposure, star FWHM, background noise as "relative, same method"), "—" with "not in file" where a header lacks the value; empty states with "Add Seestar FITS stack", "Add your final picture" (uses existing `useUploadFinalImage`), "Add Seestar picture"; no winner text anywhere.
- [ ] **Step 1: Failing tests:** backend: a JPEG with `Software="Adobe Lightroom 11.5.21 (iOS)"` → `edited_by` equals it and `edited is True`; without EXIF → `edited is None`. Vitest: pictures mode renders no element with a number other than size; stacks mode renders identical row labels for both sides; missing side shows its empty-state button which opens a file input; the words "winner", "better", "score" never appear (`queryByText(/winner|better|score/i)` is null).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS; manual with the developer's real Siril stack and the Seestar FITS once the developer supplies it (spec G2: ask for its location now, record its header in the spec §2).
- [ ] **Step 5: Commit** `feat(processing): Seestar vs Siril comparison`

### Task 12: Docs, e2e, Variable Hunter label, validation

**Files:**
- Create: `frontend/e2e/processing.spec.ts`, `backend/scripts/make_synthetic_night.py` → writes `frontend/e2e/fixtures/synthetic-night/` (`lights/` with small synthetic S30 header-only FITS whose basenames are the same ones listed in `process/light_conversion.txt`, so the e2e import and the folder upload match; `process/*.seq` from `processing_fixtures`; no real data)
- Modify: `frontend/src/pages/StarPage.tsx` + `frontend/src/components/variables/variables.test.tsx` ("Coming in Phase 4" → "Planned for a later phase"; this is the one existing assertion that must change, because the spec makes the old text untrue — say so in the commit), `docs/PROCESSING.md` (rules, constants, measurement method, sources), `README.md` (Processing Coach section + screenshots), `docs/ARCHITECTURE.md`, `ROADMAP.md`, `PROGRESS.md`, `docs/screenshots/processing-*.png`

- [ ] **Step 1:** e2e (desktop + mobile projects): import a synthetic S30 night (reuse `astrolog.spec.ts`'s header helper), open Process this night, pick the synthetic night folder with `setInputFiles`, see totals and findings, choose a selection option, download both scripts (assert filenames), click through to Compare and see the empty states. Run `npx playwright test` → 16 + new pass.
- [ ] **Step 2:** Full suites: `cd backend && .venv/bin/python -m pytest -q`; `cd frontend && npm run typecheck && npm test && npm run build && npx playwright test`. Record exact counts.
- [ ] **Step 3:** Browser check of every coach step on desktop, mobile (Pixel 7) and night vision with the real folder; screenshots `processing-report-desktop.png`, `processing-select-mobile.png`, `processing-compare-desktop.png`, `processing-night-vision.png` (real data approved for the public repo; no paths or coordinates visible).
- [ ] **Step 4:** Docs: PROGRESS.md (milestones, commands with counts, local Siril validation numbers, limitations, exact next step), ROADMAP status row "complete pending developer review", README run instructions unchanged except the new section.
- [ ] **Step 5: Commit** `docs(processing): Phase 4 docs, e2e and validation`; then stop for developer review (merge and `phase-4` tag only with approval; ask about deleting `process-coach/`).
