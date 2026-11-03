# PROGRESS

_Last updated: 2026-11-02 · Phase plan and process: see [ROADMAP.md](ROADMAP.md)_

## Current phase: Phase 2, AstroLog: complete pending developer review

Branch `phase-2-astrolog` (not yet merged). Spec: `docs/superpowers/specs/2026-11-02-astrolog-design.md`.

| Area | Status | Evidence |
|---|---|---|
| Alembic migrations (baseline + AstroLog), SQLite and Postgres | done | `backend/migrations/`, `tests/test_migrations.py` (Postgres test runs in CI via `TEST_POSTGRES_URL`) |
| FITS / CR2 header and filename parsing | done | `app/astrolog/headers.py`, `tests/test_astrolog_headers.py` |
| Header-based import preview and commit (nights, capture sets, dedup, plan attach) | done | `importer.py`, `tests/test_astrolog_import.py` |
| Final-picture previews (metadata-free) | done | `previews.py`, `tests/test_astrolog_previews.py` |
| Library, target page, history, plan vs actual | done | `library.py`, `tests/test_astrolog_library.py` |
| Local real-data acceptance (AC 1, 2, 4, 5) | done | `tests/test_astrolog_real_data.py`, 6 passed locally |
| Folder import UI (headers sliced in the browser) | done | `AstroLogImportPage.tsx`, `lib/headerSlice.ts` |
| Library and target pages, nights page | done | `LibraryPage.tsx`, `TargetLogPage.tsx`, `AstroLogPage.tsx` |
| "You have ... stacked/captured" badge on Tonight and Explore cards | done | `HistoryBadge.tsx`; e2e-verified on Explore, unit-tested on the shared card (Tonight uses the same card; not e2e-checked because Tonight shows only that night's recommendations) |
| End-to-end import test, docs, Phase 1 regression | done | `frontend/e2e/astrolog.spec.ts`, screenshots in `docs/screenshots/` |

### Final review fixes (2026-11-02)

The whole-branch review's four important findings and seven minors are fixed
(`.superpowers/sdd/2026-11-02-astrolog/final-fixes-report.md`):
"% used" now divides by the frames inside the linked stack's EXPSTART–EXPEND (returned as
`frames_in_stack_range`) and is hidden when that can't be computed; Canon ISO, f-number, focal
length and lens are stored (migration `0004_capture_exif`) and shown with their EXIF keys;
nights show local first → last frame times and per-frame exposure, and imported sessions get
start/end from their frames; "Move to Unsorted" merges into one Unsorted group (PATCH on it is 409).
Minors: stack suggestion from the chosen file name, "in the latest stack" wording, "nights unknown",
`formatIntegration` flooring, clearer night-delete 409, small UI cleanups, stronger migration tests.

### Commands last run (all passing, 2026-11-02, after the final review fixes)

```
backend:  .venv/bin/python -m pytest -q          → 198 passed, 7 skipped
frontend: npm run typecheck                       → ok
frontend: npm test                                → 69 passed (7 files)
frontend: npm run build                           → ok
frontend: npx playwright test                     → 12 passed (10 Phase 1 smoke + 2 AstroLog import, desktop + mobile)
local:    ASTROPLANNER_REAL_DATA=<folder> pytest tests/test_astrolog_real_data.py -v
                                                  → 6 passed (the 6 backend skips are these; the 7th is the Postgres test)
```

Phase 1 remains green: 66 backend tests, 23 unit tests and 10 smoke tests are all still in the totals above.
Screenshots (`astrolog-library-desktop.png`, `astrolog-target-desktop.png`) use synthetic data only.

### Known limitations (Phase 2)

- Only Seestar S30 FITS and Canon CR2 are understood; other cameras' files are skipped with a reason. Canon model names from other regions (EU/JP) are not matched to the seeded Canon profile.
- A re-import never moves frames that are already imported. To fix a wrong set name or target, change it on the target page; to fix a wrong location you would have to delete the captures and import again.
- A multi-batch commit (more than 300 files) is not atomic. If it stops part way, the review shows what is still new and a retry is safe because frames are de-duplicated. After such a failure the names, "Unsorted" choices and plan choices you made on the review screen are reset.
- If you leave the Settings round-trip ("create location from file") without coming back, a later visit to Import can reopen the old folder's review.
- Final-picture upload: the file is spooled before the 150 MB check, so a huge upload uses temporary disk first. Colour profiles are not converted to sRGB, the TIFF orientation tag is ignored, and a CMYK TIFF loses its fourth plane. Only a preview is kept, never the original.
- Two simultaneous final-picture uploads for one target on Postgres could leave two "current" pictures.
- Deleting a session that has capture sets returns 409 by design. Under a simultaneous import the check could return 500 instead.
- No cross-process migration lock; revisit at deployment. Deployment is still deferred.
- Canon frames imported before migration 0004 have no ISO / f-number / focal length / lens stored; re-importing does not back-fill them (frames are never rewritten).
- "% used" on the real Bubble Nebula data is 654 of 1,012 (65%), not the 64% in acceptance criterion 2: the last 3 of the 1,015 lights start after the stack's EXPEND, and spec §7a defines the denominator as the frames inside EXPSTART–EXPEND.

## Phase 2 exit items

- [x] All implementation tasks complete with review
- [x] Full suites and local real-data acceptance run (above)
- [ ] Developer review of the branch, then merge and push (controller)
- [ ] CI green on push (Postgres migration test only runs there)

## Exact next step

Developer reviews `phase-2-astrolog` (try Import on a real folder, view the library and a target page, check the
Tonight/Explore badge). After sign-off: merge, push, confirm CI, tag `phase-2`. Then start Phase 3 planning
(ROADMAP.md steps 1–6; no code before approval).

## Phase 1, core planning dashboard: ✅ complete (signed off 2026-11-02, tag `phase-1`)

The record below is kept as Phase 1's final state.

| # | Spec item | Status | Evidence |
|---|---|---|---|
| 1 | App shell: Tonight, Explore, Research Lab, AstroLog, Settings | ✅ | sidebar (desktop) / bottom nav (mobile); `docs/screenshots/` |
| 2 | Manual location (city search / coordinates), timezone, saved; opt-in geolocation; labelled sample location | ✅ | `/api/geocode`, `/api/timezone`, `/api/locations`; Settings page |
| 3 | Verified Seestar S30 preset + custom profiles | ✅ | preset immutable (403), duplicate → custom; `fov_definition: unknown` |
| 4 | Real forecast with loading / error / no-data / last-updated | ✅ | Open-Meteo adapter, cache, statuses `ok/unavailable/error`, lead-time label, past-night note |
| 5 | Accurate Sun, Moon, target positions; local-night timeline | ✅ | Astropy; USNO/Meeus reference tests |
| 6 | Tonight's Score 0–100 with documented components | ✅ | `docs/SCORING.md`; no total without weather |
| 7 | ≥ 20 sourced targets with distinct IDs | ✅ | 58 OpenNGC targets, pinned commit, provenance per target |
| 8 | Ranked, filterable target cards + altitude-vs-time graph | ✅ | `/api/recommendations`, sparklines, detail chart |
| 9 | Target detail: identifiers, coordinates, chart, Moon separation, best (forecast-adjusted) window, Add to Session | ✅ | Explore drawer |
| 10 | Sessions: create, add, reorder, remove, persist across reloads | ✅ | API test incl. restart persistence; Playwright e2e incl. reload |
| 11 | Deterministic astronomy/scoring tests, responsive layout, README | ✅ | 66 backend + 23 frontend unit + 10 e2e tests |

### Completed in the latest increment (Phase 1 review feedback: new theme)

- New visual theme **"Clean Planetarium"**, chosen by the developer from three mockups:
  near-black sky with a static, seeded starfield (`scripts/gen-starfield.mjs`), white type,
  Inter as the only font, one blue accent for interactive and "best" highlights, muted
  orange for cautions. The previous serif headings and gold accents are removed.
- **Night-vision mode**: header toggle turns the entire app dim red (text, charts,
  starfield, score) via CSS variables on `<html data-vision>`; persisted, applied before
  first paint, charts re-read theme colours on toggle. New e2e test verifies red-dominant
  text and persistence across reload.
- Mobile header is no longer sticky (it grew to four rows); desktop header still sticky.
- Doc screenshots regenerated in the new theme (incl. `tonight-night-vision.png`).

### Completed in the previous increment

- `ROADMAP.md` created; phase numbering adopted across UI and docs (AstroLog = Phase 2,
  Variable Hunter = Phase 3, image analysis = Phase 4).
- Accessible confirmation dialog (native `<dialog>`, focus on Cancel for destructive actions)
  replaces `window.confirm()` for session, location and equipment deletion.
- Equipment selector visible in the mobile header.
- Code splitting: lazy routes and lazy Recharts charts; main JS 725 kB → 348 kB (108 kB gzip).
- Playwright smoke suite (`frontend/e2e/smoke.spec.ts`): runs real backend on a fresh DB on
  dedicated ports (8100/5180); desktop + Pixel 7 projects.
- Geocoding maps Open-Meteo's −9999 elevation sentinel to "unknown".

### Commands last run (all passing, 2026-11-02)

```
backend:  .venv/bin/python -m pytest -q     → 66 passed
frontend: npm run typecheck                  → ok
frontend: npm test                           → 23 passed
frontend: npm run build                      → ok, no chunk-size warning
frontend: npm run test:e2e                   → 10 passed (desktop + mobile, incl. night vision)
manual:   new theme + night vision reviewed in browser (Tonight, Explore detail, Settings,
          confirm dialog) at 1440 px and 390 px
```

### Acceptance criteria (spec §11)

1 run locally ✅ · 2 forecast or explicit unavailable, date persists ✅ · 3 ≥ 20 targets + search ✅ ·
4 altitude realistic + 2+ independent references ✅ (`docs/ASTRONOMY.md`) · 5 no daytime-only
recommendations, 30° enforced ✅ · 6 twilight/Moon/local times computed and in observer tz ✅ ·
7 components sum, bounded, no fake weather ✅ · 8 add/remove/reorder/persist ✅ · 9 responsive +
empty/error states ✅ · 10 no fake observations/events ✅ · 11 tests for seasons, DST, no darkness,
never visible, no forecast, normalization ✅ · 12 README + architecture + next checklist ✅

## Known limitations

- **Not deployed.** Runs locally; repo and CI are on GitHub.
- CI uses `actions/*@v4/v5`, which GitHub now force-runs on Node 24 (deprecation warning, not a failure).
- Altitudes ignore atmospheric refraction (≈1.7′ at 30°); no local horizon/obstruction model.
- Weather cache is in-process memory; model run time is not available from the endpoint used.
- Score weights are heuristics, uncalibrated against real outcomes.
- E2E tests call live Open-Meteo; they tolerate either a forecast or an explicit unavailable state.
- (Closed in Phase 2: schema now uses Alembic migrations.)

## Phase 1 exit items (all closed)

- [x] Git + GitHub: https://github.com/JoeyPhatsJr/astroplanner (public); first CI run green
      (backend, frontend, e2e jobs; run 41532298528)
- [x] Deployment: deferred until the project is nearly complete (ROADMAP.md, "Deployment")
- [x] Phase 1 review with the developer → signed off 2026-11-02 (after theme feedback was addressed)
