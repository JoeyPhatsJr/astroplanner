# PROGRESS

_Last updated: 2026-11-02 · Phase plan and process: see [ROADMAP.md](ROADMAP.md)_

## Current phase: Phase 2, AstroLog (planning)

Phase 2 follows ROADMAP.md steps 1–6: review, brainstorm, propose, risks, plan with
acceptance criteria, then **wait for approval** before any implementation.

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
- Schema uses `create_all`; Alembic baseline planned at the start of Phase 2 (see ROADMAP).

## Phase 1 exit items (all closed)

- [x] Git + GitHub: https://github.com/JoeyPhatsJr/astroplanner (public); first CI run green
      (backend, frontend, e2e jobs; run 41532298528)
- [x] Deployment: deferred until the project is nearly complete (ROADMAP.md, "Deployment")
- [x] Phase 1 review with the developer → signed off 2026-11-02 (after theme feedback was addressed)

## Exact next step

Start Phase 2 (AstroLog) planning with the developer: step 1 (review the Phase 1 codebase
and what AstroLog can build on) and step 2 (brainstorm the logging experience). No Phase 2
code until the plan and acceptance criteria are approved (ROADMAP.md step 6).
