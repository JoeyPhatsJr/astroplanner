# PROGRESS

_Last updated: 2026-11-02 · Phase plan and process: see [ROADMAP.md](ROADMAP.md)_

## Current phase: Phase 1, core planning dashboard (in completion)

Phase 1 is functional and tested locally. Remaining exit items are listed at the bottom.

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
| 11 | Deterministic astronomy/scoring tests, responsive layout, README | ✅ | 66 backend + 23 frontend unit + 8 e2e tests |

### Completed in the latest increment

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
frontend: npm run test:e2e                   → 8 passed (desktop + mobile)
manual:   confirm dialog + mobile header checked in browser (390 px)
```

### Acceptance criteria (spec §11)

1 run locally ✅ · 2 forecast or explicit unavailable, date persists ✅ · 3 ≥ 20 targets + search ✅ ·
4 altitude realistic + 2+ independent references ✅ (`docs/ASTRONOMY.md`) · 5 no daytime-only
recommendations, 30° enforced ✅ · 6 twilight/Moon/local times computed and in observer tz ✅ ·
7 components sum, bounded, no fake weather ✅ · 8 add/remove/reorder/persist ✅ · 9 responsive +
empty/error states ✅ · 10 no fake observations/events ✅ · 11 tests for seasons, DST, no darkness,
never visible, no forecast, normalization ✅ · 12 README + architecture + next checklist ✅

## Known limitations

- **Not deployed and not under git yet.** CI workflow is written but has never run on GitHub.
- Altitudes ignore atmospheric refraction (≈1.7′ at 30°); no local horizon/obstruction model.
- Weather cache is in-process memory; model run time is not available from the endpoint used.
- Score weights are heuristics, uncalibrated against real outcomes.
- E2E tests call live Open-Meteo; they tolerate either a forecast or an explicit unavailable state.
- Schema uses `create_all`; Alembic baseline planned at the start of Phase 2 (see ROADMAP).

## Remaining Phase 1 exit items

- [ ] `git init`, first commit, push to the developer's GitHub; confirm CI green
- [ ] Decide whether deployment (Vercel + Supabase + owner-only auth) is part of Phase 1's exit
- [ ] Phase 1 review with the developer → sign-off

## Exact next step

Developer reviews Phase 1 in the running app and decides on git/GitHub and the deployment
question. Phase 2 (AstroLog) planning starts only after sign-off, following ROADMAP.md steps 1–6.
