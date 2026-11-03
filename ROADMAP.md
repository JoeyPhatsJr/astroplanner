# AstroPlanner Roadmap

_Last updated: 2026-11-02 · Owner: project developer · Maintained alongside `PROGRESS.md`_

AstroPlanner is developed **collaboratively, one phase at a time**. A phase's detailed
requirements are defined only when that phase begins, after the previous phase is
functional, tested and reviewed. This document holds the plan, the per-phase process,
the architectural seams that let later phases grow cleanly, and a decision log.
`PROGRESS.md` holds the day-to-day status of the current phase.

## Phase overview

| Phase | Name | Scope (summary) | Status |
|---|---|---|---|
| 1 | Core planning dashboard | Location, equipment, real forecast, Sun/Moon/target visibility, transparent scores, catalog, charts, saved session plans | ✅ **Complete**: signed off 2026-11-02 (git tag `phase-1`) |
| 2 | AstroLog | Observing sessions as logs, image uploads, equipment history, personal astrophotography library | ✅ **Complete**: signed off 2026-11-02 (PR #1, git tag `phase-2`; spec `docs/superpowers/specs/2026-11-02-astrolog-design.md`) |
| **3** | Variable Hunter | Historical light curves, variable-star research, AstroMissions | **Planning** (steps 1–5) |
| 4 | Scientific image analysis | FITS processing, photometry, user-generated light curves | Not started |
| 5 | Advanced features | Personalization, collaboration, 3D visualization, telescope integrations | Not started |

> The original build brief (`ASTROPLANNER_SPEC.md`) numbered AstroLog "Phase 1.1",
> the Research Lab "Phase 1.2" and image analysis "Phase 2". **This roadmap supersedes
> that numbering**; the spec remains the source of truth for accuracy standards.

## How each phase is run

Every phase follows the same ten steps. Implementation never starts before step 6.

1. **Review** the existing codebase and completed functionality.
2. **Brainstorm and refine** features and user experience together.
3. **Propose** the technical implementation and dependencies.
4. **Identify risks:** scientific, technical and architectural problems.
5. **Present** a clear implementation plan with acceptance criteria.
6. **Wait for approval** from the developer. ⛔ Gate.
7. **Build incrementally** in small, testable milestones.
8. **Test** all features and **verify scientific calculations** against independent references.
9. **Update documentation** (`README.md`, `docs/`, `PROGRESS.md`, this roadmap).
10. **Preserve** working functionality from previous phases (all earlier test suites stay green).

Standing rules for every phase (from `CLAUDE.md`): no fabricated data or results,
uncertainty and heuristic labels on scores, source attribution and license compliance,
no dead buttons, no claimed tests that were not run.

## Phase 1: core planning dashboard

**Delivered and verified (local):** see `PROGRESS.md` for the item-by-item table.
66 backend tests (incl. USNO and Meeus reference checks), 23 frontend unit tests and
10 Playwright end-to-end smoke tests (desktop + mobile) pass.
Review feedback so far: theme replaced with "Clean Planetarium" + night-vision mode (done).

**Remaining to complete Phase 1**

- [x] Adopt this roadmap's phase numbering in the UI and docs
- [x] Accessible in-app confirmation dialog (native `<dialog>`; replaces browser `confirm()`)
- [x] Equipment selector reachable from the header on mobile
- [x] Code splitting: lazy routes + lazy chart library (main bundle 725 kB → 348 kB)
- [x] Automated Playwright smoke test of the core flow (desktop + mobile, 8 tests passing)
- [x] Under git, public on GitHub (`JoeyPhatsJr/astroplanner`); CI green on first run
- [x] Deployment decision: **deferred** until the project is nearly complete (not a Phase 1 exit item; see "Deployment" below)
- [x] **Phase 1 review** with the developer → **signed off 2026-11-02**

**Exit criteria:** spec §11 acceptance criteria all met (currently met locally), the items
above closed, and explicit developer sign-off.

## Phase 2: AstroLog

**Delivered and verified:** header-only folder import (Seestar S30 FITS, Canon CR2) into a
target-first library with final pictures, time in the final stack, nights as logs and a
planner badge. 198 backend tests (6 local real-data acceptance checks and 1 Postgres migration
test among the 7 that skip without their environment), 69 frontend unit tests and 12 Playwright
end-to-end tests. Signed off 2026-11-02; merged in PR #1 (tag `phase-2`). Details and known
limitations are in `PROGRESS.md`.

## Deployment (deferred)

AstroPlanner stays **local-only** while phases are being built. Deployment is a dedicated
milestone scheduled when the project is nearly complete, so hosting choices can account
for later phases' needs (e.g. image storage in Phase 2, FITS processing in Phase 4).

- Current target: Vercel (frontend + Python function) + Supabase (Postgres, Auth, Storage).
- Prerequisites before going public: `owner_id` on user-owned rows, Supabase Auth JWT
  verification in FastAPI (owner-only writes), production CORS, secrets in environment variables.
- To re-check at that time: Vercel Python function size/cold start with Astropy, whether
  Phase 4 processing needs a different compute target, Open-Meteo terms for the use case.
- Meanwhile every phase must keep the `DATABASE_URL` seam working (no SQLite-only SQL).

## Later phases: direction only (not yet requirements)

These notes record intent and the questions each phase must answer in its own steps 1–5.
Nothing here is approved for implementation.

### Phase 3: Variable Hunter
- Intent: curated variable-star research and AstroMissions linking targets, sessions and goals.
- Questions to settle: what AAVSO/VSX data can be used under their terms and through which
  documented interface (no scraping); ephemeris validation before showing any prediction
  window; which targets are realistic for a 30 mm aperture.

### Phase 4: Scientific image analysis
- Intent: FITS import, differential aperture photometry (photutils), user light curves.
- Questions to settle: S30 colour-sensor and filter limitations, calibration requirements,
  uncertainty propagation, and clear "instrumental, not standardised" labelling.

### Phase 5: Advanced features
- Intent: personalization (e.g. local horizon "SkyTwin", learning from session outcomes),
  collaboration, 3D visualization, telescope integrations.
- Questions to settle: only documented telescope interfaces; accounts and data sharing need a
  security and privacy review first.

## Architecture: seams for growth (without building later features)

Phase 1 is deliberately limited to Phase 1 tables and features. These existing boundaries
are where later phases attach; each "later" item is a note, not code.

| Seam (exists now) | Where | How later phases use it |
|---|---|---|
| Sessions with `status` (`planned/completed/cancelled`) and per-target rows with `actual_integration_seconds`, `notes` | `backend/app/db.py` | Phase 2 extends sessions into logs instead of creating a parallel model |
| Pluggable data providers injected via `app.state` (weather today) | `backend/app/main.py`, `weather.py` | Phase 3 adds an AAVSO/VSX provider behind the same pattern, stubbed in tests |
| Visibility engine is target-agnostic (RA/Dec in → windows, statuses out) | `astronomy.py`, `visibility.py` | Phase 3 variable stars reuse it; *later:* `sky_context` takes an explicit coordinate set instead of the global catalog |
| Scores are lists of `{key, points, max, basis, detail}` components | `scoring.py` | New factors (e.g. horizon obstruction, personal history) are added as components; normalization tests guard them |
| Catalog with per-target provenance (`source`, `source_id`, `source_url`) | `app/data/targets.json` | Additional curated catalogs (variable stars) follow the same provenance rule |
| Typed API client + React Query hooks per resource | `frontend/src/api/` | New phases add resources without touching existing hooks |
| Route per section, with Research Lab and AstroLog previews already in place | `frontend/src/App.tsx`, `pages/` | Each phase replaces its preview page with real functionality |
| `DATABASE_URL` switch (SQLite ↔ Postgres/Supabase) | `db.py` | Production persistence with no code change |

**Done in Phase 2:** Alembic migrations with a baseline of the Phase 1 schema (an existing Phase 1 database is stamped, then upgraded).

**Planned before any public deployment:** an `owner_id` on user-owned rows and JWT
verification in FastAPI (Supabase Auth). Until then the app is single-user and local.

## Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-11-02 | Stack: React + TypeScript + Vite + Tailwind; FastAPI + Astropy; SQLite locally | Spec §4; scientific Python for astronomy |
| 2026-11-02 | All astronomy on the backend; the frontend only formats | One source of truth; no duplicated celestial math |
| 2026-11-02 | Night = local noon → noon in the observer's IANA timezone, UTC internally | Correct evening attribution and DST handling |
| 2026-11-02 | Target catalog derived from OpenNGC (58 objects, CC BY-SA 4.0, pinned commit) | Trustworthy coordinates with provenance |
| 2026-11-02 | No weather → no Tonight's Score total; target scores shown out of 75 | Never fake or silently rescale forecast-derived numbers |
| 2026-11-02 | S30 FOV used only for advisory framing notes, never in scores | Published 2.46° FOV axis is unspecified |
| 2026-11-02 | Hosting target: Vercel (frontend + Python function) + Supabase (Postgres + Auth) | Free tier, single primary user; code already supports `DATABASE_URL` |
| 2026-11-02 | Adopt the five-phase roadmap above; one phase at a time with an approval gate | Developer direction |
| 2026-11-02 | Repository public on GitHub with CI (backend, frontend, e2e) | Visibility and regression protection |
| 2026-11-02 | Defer deployment until the project is nearly complete | Developer direction; hosting needs depend on later phases |
| 2026-11-02 | **Phase 1 signed off** by the developer; tagged `phase-1` | All exit items closed; 66 backend + 23 unit + 10 e2e tests and CI green |
| 2026-11-02 | Visual theme "Clean Planetarium" (black + starfield, Inter, single blue accent) + red night-vision mode | Developer review: previous theme mixed "sci-fi" and "golden marble" personalities; chosen from three mockups. Night vision preserves dark adaptation at the telescope |
| 2026-11-02 | Phase 2 adopts Alembic migrations (baseline + AstroLog), written for SQLite and Postgres | First schema change after Phase 1; keeps the `DATABASE_URL` seam honest |
| 2026-11-02 | **Header slicing happens in the browser**: only FITS header blocks / CR2 first 128 KB are sent for parsing | A server cannot read a user's folders, it works the same when deployed, and image data never leaves the disk |
| 2026-11-02 | **Header coordinates are never stored or returned**; used only to match a saved location (5 km) and pick the timezone | Privacy of the user's precise site; the only exception is a user-initiated "create location from file" that returns coordinates rounded to 0.01 degrees |
| 2026-11-02 | **Stacks are never summed**; headline is the stack linked to the final picture, else captured time labelled "captured" | A later stack re-uses earlier frames, so adding stacks would overstate integration |
| 2026-11-02 | **Stack-only targets are shown**; their captured time is unknown (null), never 0, and the latest stack is the headline until a final picture is linked | Hiding real integration time or showing "0 s captured" would both be wrong |
| 2026-11-02 | **Re-import never moves already-imported frames**; groups with no new frames create nothing; corrections go through the target page | Prevents phantom nights/targets and duplicates; a "move captures" feature is a possible later addition |
| 2026-11-02 | Imported observations are never deleted as a side effect (foreign keys RESTRICT; deleting a session with capture sets returns 409) | The user's records are the product |
| 2026-11-02 | **Phase 2 signed off** by the developer; merged (PR #1) and tagged `phase-2` | Real-data acceptance passed locally; CI green on the PR and the merge commit |
