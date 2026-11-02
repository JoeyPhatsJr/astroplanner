# Phase 2 design: AstroLog

_Status: ready for developer approval (builder-checked) · 2026-11-02 · follows ROADMAP.md steps 1–5_
_Brainstormed with the developer; items marked **(builder's/Claude's call)** were not decided by the developer and may be changed by the builder if they find a better option._

## 1. Intent

AstroLog turns the image files the developer already produces into an automatic,
target-organized record of their astrophotography, so that looking back at a target
immediately shows **the final picture and how long it was shot**. It must cost almost
no typing, and it must give reasons to come back: progress that accumulates on a target,
and a planner (Phase 1 "Tonight") that knows what has already been shot.

## 2. Who and what (from the developer's real files)

Inspected read-only in the developer's local astrophotography folder (51 GB; its path is
supplied to local tests via the `ASTROPLANNER_REAL_DATA` environment variable). Do not copy these
files into the repo: they are large and contain the developer's precise location.

- **Seestar S30 sub-frames:** `<Target>/lights/Light_<OBJECT>_<exp>s_<FILTER>_<YYYYMMDD-HHMMSS local>.fit`,
  e.g. `Light_NGC 7635_10.0s_LP_20260911-231147.fit`. 16-bit, 1080×1920, Bayer `GRBG`.
  Header keys present: `CREATOR`=`ZWO Seestar S30`, `INSTRUME`=`Seestar S30`,
  `TELESCOP`=`S30_<serial>`, `OBJECT`, `RA`, `DEC` (deg), `DATE-OBS` (UTC, ISO), `DATE-EXP`,
  `EXPTIME`/`EXPOSURE` (s), `FILTER` (`LP`), `GAIN`, `CCD-TEMP`, `FOCUSPOS`, `FOCALLEN`=150,
  `XPIXSZ`=2.9, `SITELAT`, `SITELONG`, `IMAGETYP`=`Light`, `EQMODE`, `WIDECAM`.
  **`APERTURE`=5.0 is wrong for a 30 mm scope**: header values must not override the verified
  equipment profile.
- **Siril stacks:** e.g. `NGC_7635_654x10sec_T32degC_2026-09-11.fit` (32-bit float, 3×1920×1080),
  `PROGRAM`=`Siril 1.4.4`, `STACKCNT`=654, `LIVETIME`=6540.0 s, `EXPSTART`/`EXPEND` (JD),
  plus the Seestar keys and Siril `HISTORY` describing the stacking method.
- **Processed finals:** e.g. `starnet_NGC_7635_…tif`: 16-bit-per-channel RGB TIFF with **no**
  embedded stacking metadata. JPEG/PNG exports also exist.
- **Capture vs. stack:** Bubble Nebula has 1,015 sub-frames captured (23:11→05:44 local,
  ≈2 h 49 m) but only 654 were stacked (1 h 49 m). Both numbers are real and both matter.
- **Canon EOS Rebel T3** (EF-S 18–55 mm kit lens): `.CR2` raws in date folders, EXIF has
  camera, lens, exposure, ISO, f-number, focal length, capture time; **no GPS, no target name**.
  Some sets are non-astronomical (e.g. `lightning & clouds`).
- Siril working folders (`process/`, `.seq`, `.lst`, `pp_light_*`) and StarNet binaries also
  live in these folders and must be ignored by import.

## 3. Goals

1. **Automatic import from files.** The developer selects a folder (a night or a target folder);
   AstroLog reads headers/EXIF and builds logs: target(s), night, start→end, frame count,
   per-frame exposure, captured integration, filter, gain, sensor temperature range, device.
2. **Library organized by target** (developer's choice): a grid of targets, each with its chosen
   final picture and total time; a target page with the picture, **time in the final stack**
   (headline) and **time captured**, header-derived facts with their source key, and the list of
   contributing nights. Totals accumulate across nights.
3. **Final picture**: the developer chooses one image per target as "final" (any of FITS,
   TIFF, JPEG, PNG). AstroLog stores a small preview only; the full file stays on disk.
4. **Stack time**: from a stacked FITS (`STACKCNT`×`EXPTIME`, or `LIVETIME`); fallback parsed
   from a Siril-style filename `<N>x<S>sec`, labelled "from filename". Never guessed otherwise.
5. **Plan vs. actual**: an import for a night links to that night's planned session if one
   exists (same local night date; location match), showing planned targets vs. shot targets.
   If no plan exists, a completed session is created.
6. **Planner knows history**: Tonight/Explore target cards show "you have X on this target"
   for targets already in the library.
7. **Equipment, simply**: each log records the device from the files (`INSTRUME` /
   Canon EXIF model) and a frozen snapshot of the matching equipment profile, so later
   profile edits never rewrite history. Add a Canon EOS Rebel T3 + 18–55 mm profile
   (approximate FOV from APS-C sensor and focal length, marked approximate).
8. **Canon and non-target sets**: Canon imports group by capture time into a set the developer
   names (e.g. "Milky Way (wide field)"); unrelated frames can go to **Unsorted**.
9. **Night-based view** remains available (existing AstroLog session list, now showing actuals).

## 4. Non-goals (Phase 2)

- Image processing, stacking, calibration, photometry or light curves (Phase 4).
- Seestar API or any telescope connection (undocumented; spec forbids; Phase 5 at earliest).
- Sharing, public profiles, social features, accounts; deployment (deferred, ROADMAP).
- Uploading or storing full-resolution files or whole folders.
- A versioned equipment timeline (developer only uses two devices).

## 5. Anti-goals (would make it a failure even if it works)

- **Typing everything in.** Anything the files say must be filled in automatically; manual input
  is limited to choosing the final picture, naming Canon sets, and optional notes.
- **No reason to come back.** Accumulating per-target totals, history on Tonight's cards and
  plan-vs-actual must be present at launch, not deferred.
- **Leaking location.** Precise `SITELAT`/`SITELONG` must never be displayed, exported,
  committed, or written into previews.
- **Faking numbers.** Unknown values are shown as unknown, never estimated (e.g. stack time
  without a stacked FITS or a parseable filename stays "unknown").

## 6. Constraints

- Standing rules from `CLAUDE.md` and the spec: no fabricated data, provenance for every
  number, accessible UI, honest empty/error states, tests for all computation.
- **Preserve Phase 1**: all existing tests stay green (66 backend, 23 unit, 10 e2e); the
  `DATABASE_URL` seam keeps working (no SQLite-only SQL).
- **Deployment-ready shape** without deploying: the import path must work the same when the
  app is later hosted on Vercel/Supabase, i.e. it cannot depend on the server reading the
  developer's disk.
- Night attribution uses Phase 1 rules: a frame belongs to the local night (local noon→noon in
  the location's IANA timezone) containing its `DATE-OBS` (UTC).
- Visual style: the Phase 1 "Clean Planetarium" theme and night-vision mode apply to all new
  screens.
- First schema change of the project: introduce **Alembic** with a Phase 1 baseline revision,
  then the Phase 2 migration (ROADMAP commitment).

## 7. Decisions already made

**By the developer:** library is target-first; first things shown are the final picture and how
long it was shot; files are imported, not typed; Seestar + Canon only; no deploy yet; theme as Phase 1.

**(Claude's call, builder may revise with reason):**

- **Import runs in the browser, parsing on the server.** The UI lets the developer pick a folder
  (`<input type="file" webkitdirectory>` / drag-and-drop). The browser reads only each file's
  **header bytes** (FITS: 2880-byte blocks until the `END` card, typically 2 blocks; CR2: first
  ~128 KB for EXIF) and sends those slices to the backend, which parses them with Astropy
  (FITS) and `exifread` (CR2). Pixel data never leaves the disk. Reason: works identically when
  deployed; a server can't read a user's local folders.
- **Final-picture preview** is the one file uploaded: the browser sends the chosen image; the
  backend decodes it (`tifffile` for 16-bit/float TIFF, Astropy for FITS with an auto-stretch,
  Pillow for JPEG/PNG), writes a ~1600 px long-edge JPEG **with no metadata** plus a ~400 px
  thumbnail. Upload limit 150 MB. Previews are stored via a small storage interface
  (local `backend/data/previews/`, gitignored; Supabase Storage later).
- **Location privacy:** header coordinates are used only to (a) determine the timezone/night
  and (b) match a saved location within 5 km. Only the matched `location_id` (or, if none, a
  "not matched" flag) is stored; raw coordinates are discarded after the request. If unmatched,
  the UI asks which saved location to use (or to create one via the existing Settings flow).
- **Target identity:** `OBJECT` is normalized ("M 27", "M27", "NGC 7635", "NGC7635") and
  matched to the catalog via ids/aliases. Unknown objects become **custom targets** keyed by
  the normalized name, with header RA/Dec stored as provenance. Canon sets are custom targets
  named by the developer.
- **Deduplication:** frames are unique on (`TELESCOP` or camera serial/model, `DATE-OBS`,
  `EXPTIME`, source filename); re-importing a folder updates rather than duplicates.
- **Ignore rules:** skip Siril/working outputs (`process/`, `pp_*`, `r_*`, `*.seq`, `*.lst`,
  dotfiles, non-image files); treat a FITS with `STACKCNT` as a **stack**, `IMAGETYP=Light`
  without `STACKCNT` as a **sub-frame**.
- **Data model (Phase 2 tables, extending Phase 1 sessions):**
  - `library_targets`: id, catalog_target_id?, custom_name?, normalized_key (unique),
    kind (`catalog|custom|unsorted`), created_at.
  - `capture_frames`: id, session_id, library_target_id, device, date_obs_utc, exptime_s,
    filter?, gain?, ccd_temp_c?, source_filename, dedup_key (unique), imported_at.
  - `stacks`: id, library_target_id, session_id?, source_filename, stack_count?, livetime_s?,
    exptime_s?, program?, provenance (`header|filename`), imported_at.
  - `final_images`: id, library_target_id, stack_id?, source_filename, format, preview_path,
    thumb_path, width, height, chosen_at (one current final per target; history kept).
  - `sessions` gains `equipment_snapshot` (JSON) and `source` (`planned|imported|both`);
    `session_targets` gains captured/stacked integration summaries (or these are computed;
    builder's choice, but computed totals must equal the sum of frames).
  - Canon profile added as a seeded **custom** (not verified) equipment preset.
- **"You have X on this target"** on Tonight/Explore uses stacked time when known, else captured
  time, and says which.
- **Tests use synthetic files** generated in tests with the exact header keys above (never the
  developer's files). An optional local-only test can point at the real folder via an
  environment variable and is skipped in CI.

## 7a. Resolved after builder review (Claude's calls unless noted)

- **Which stack is "time in the final stack":** each final image links to at most one stack.
  The headline is that stack's integration (`LIVETIME`, else `STACKCNT`×`EXPTIME`, else the
  filename fallback). Stacks are **never summed** (a multi-night stack re-uses earlier frames).
  If the final picture has no linked stack, or there is no final picture, the headline shows
  **captured** time, labelled "captured" (never presented as stacked).
  "% used" = stack frame count ÷ captured frames whose `DATE-OBS` falls inside the stack's
  `EXPSTART`–`EXPEND` (JD) range; if the stack lacks that range, "% used" is not shown.
  **Accumulating totals** = captured time (sum of unique frames over all nights); the
  Tonight/Explore badge shows the same value as the target page headline, with its label.
  A Seestar-app stacked FITS (has `STACKCNT`) is a valid stack like a Siril one.
- **Session identity:** one session per (local night, location). Device-specific facts live on
  each **capture set** (night × target × device), which carries its own `equipment_snapshot`;
  the session-level snapshot field from §7 moves to capture sets. `session_targets` gets a
  nullable `library_target_id` so custom and Canon targets can be attached (catalog `target_id`
  stays for Phase 1 plans).
- **Attaching to a plan:** candidate = planned sessions on the same local night whose location
  matches (or has no location). Exactly one → attach; several → the import screen asks which;
  none → create a session with status `completed`. Attaching sets status to `completed`
  automatically (user can change it back); planned targets not shot are shown as "not shot".
- **Location privacy scope:** the rule covers **coordinates read from files**. They are used
  only inside the import request (timezone + match within 5 km) and never stored or returned.
  Saved locations are user-managed data and keep working as in Phase 1. If no saved location
  matches, the import is held in the browser until the user picks a saved location or creates
  one; "create from file" pre-fills coordinates **rounded to 0.01°** (~1 km) only when the user
  clicks it, and says so. The privacy test checks import responses, session/library responses
  and preview bytes for the header coordinates.
- **Canon profile:** seeded once as an ordinary **editable custom** profile
  ("Canon EOS Rebel T3 + EF-S 18–55 mm", not verified, not re-created if deleted), focal length
  18 mm with the zoom range in notes; FOV computed for 18 mm and marked approximate. Matching a
  CR2 to it uses the EXIF camera model. Canon sets may be assigned to a **catalog** target
  (e.g. M 42 at 55 mm) or a custom one; sets given the same name accumulate on one target.

**Answered by the developer (2026-11-02):**

- **Canon clock is set to local time.** Canon EXIF capture times are interpreted as local time
  in the location the user picks for that import (no GPS in the files), converted to UTC with
  zoneinfo (DST-aware), then assigned to a night with the Phase 1 rule. The import screen offers
  an optional clock-offset correction (± hours/minutes) for a camera that was set wrong.
- **Real files may be used for acceptance checks.** A local-only pytest module reads the real
  folder from `ASTROPLANNER_REAL_DATA` (skipped when unset, so never in CI) and asserts
  acceptance criteria 1, 2, 4 and 5 against the developer's actual files. It reads files
  read-only, writes nothing into that folder, commits nothing from it, and its assertions and
  logs never print coordinates or serial numbers. Synthetic fixtures still cover CI.

## 8. Risks to resolve during implementation

1. **Browser folder reading at scale:** ~1,000–3,000 files per folder. Header slicing keeps
   uploads to ~6 KB per FITS; batch requests (e.g. 200 headers each) with progress UI. Verify
   in Chrome and Safari.
2. **Siril TIFF/PNG metadata:** confirmed absent in the developer's StarNet TIFF; stack time
   must come from a stacked FITS or the filename. Make linking a stack to a final image easy
   (auto-suggest the stack whose filename matches).
3. **16-bit/float TIFF decoding:** Pillow's 48-bit RGB TIFF support is limited; use `tifffile`
   + NumPy. FITS/float data needs an auto-stretch for previews (document the stretch; previews
   are for recognition, not science).
4. **Header trust:** treat header equipment fields as hints; equipment comes from the profile.
   `APERTURE`=5.0 is a known bad value.
5. **Mixed folders:** one folder may hold several targets or nights; group by (night, target).
   Local-time filenames vs UTC `DATE-OBS`: always use `DATE-OBS`.
6. **Night attribution without a location match:** use the header coordinates' timezone for
   the night, then ask the user to confirm the location.
7. **Storage growth:** previews only (≈300–600 KB per final image); no raws.
8. **Migrations:** baseline must match the existing Phase 1 schema exactly so existing local
   databases upgrade cleanly; test upgrade from a Phase 1 database file.

## 9. Acceptance criteria

1. Selecting the developer's `Bubble Nebula/lights` folder produces one session (night of
   11 Sep 2026) with target NGC 7635, **1,015 frames, 10 s each, captured 2 h 49 m 10 s**,
   first/last frame times matching the filenames' local times, filter LP, gain 200; importing
   it a second time creates no duplicates.
2. Importing `NGC_7635_654x10sec_…fit` records a stack with **654 frames, 1 h 49 m**
   (`LIVETIME` 6540 s, provenance "header"); the target page headline shows 1 h 49 m in the
   final stack and 2 h 49 m captured, with 64% used.
3. Choosing the StarNet TIFF as the final picture shows its preview on the target page and the
   library grid; the stored preview contains no EXIF/FITS metadata; the original file is
   untouched and not stored.
4. `Dumbell Nebula/lights` maps to catalog target **M 27** (from `OBJECT`), 344 frames.
5. A Canon CR2 folder imports with camera/lens/exposure/ISO from EXIF, grouped into a set the
   user names; an unrelated set can be moved to Unsorted.
6. If a planned session exists for that night and location, the import attaches to it and the
   session shows planned vs. shot targets; otherwise a completed session is created.
7. Tonight/Explore cards show "you have X on this target" (stacked or captured, labelled) for
   targets in the library, and nothing for others.
8. Precise site coordinates never appear in any API response, UI, preview file, log or export;
   a test asserts this for responses and preview bytes.
9. Editing an equipment profile after import does not change past sessions' equipment snapshot.
10. Alembic: a Phase 1 database upgrades to Phase 2 with data intact; a fresh database builds
    from migrations; works on SQLite and Postgres (CI runs SQLite; Postgres checked once locally
    or in CI service container).
11. All Phase 1 tests still pass; new backend tests cover header parsing, night attribution
    across midnight and DST, dedup, integration totals, filename fallback, privacy; new e2e
    test imports a synthetic folder and sees the target page.
12. Empty, loading, error and partial states: unreadable/corrupt files are listed with reasons
    and skipped; nothing is silently dropped.

## 10. Left to the builder

Exact UI layout beyond the reviewed mockup (target page: picture left, time and facts right,
nights below; library grid of target tiles), component structure, batching sizes, preview
stretch algorithm details, whether integration summaries are stored or computed, API route
naming, and test file organization.

## 11. Reviewed mockup

`.superpowers/brainstorm/79386-1793659280/content/library-target-v2.html` (local only,
gitignored; it embeds a preview of the developer's image). Values marked `[illustrative]` there
are placeholders, not data.
