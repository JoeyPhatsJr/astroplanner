# AstroPlanner Roadmap

_Last updated: 2026-11-09 · Owner: project developer · Maintained alongside `PROGRESS.md`_

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
| 3 | Variable Hunter | Curated variable stars, visibility, AstroMissions (no AAVSO observations) | ✅ **Complete**: merged 2026-11-03 (PR #2, git tag `phase-3`; spec `docs/superpowers/specs/2026-11-02-variable-hunter-design.md`) |
| 4 | Processing Coach | Step-by-step Siril processing guide for a night's Seestar frames, built from Siril's own measurements; Siril scripts; Seestar vs your stack side by side | ✅ **Complete**: merged 2026-11-04 (PR #3, git tag `phase-4`; spec `docs/superpowers/specs/2026-11-03-processing-coach-design.md`). Open: Seestar stacked FITS for the measured comparison (G2) |
| **Polish** | Polish pass | Foundations, redesigned Tonight, sky images, motion, phone, night vision, consistency | ✅ **Complete**: merged (PR #4, merge commit 0ad8aae); design approved 2026-11-09 (spec `docs/superpowers/specs/2026-11-09-polish-pass-design.md`); real-phone and dark-room tests pending |
| **Polish 2** | Polish pass 2 | Type scale, night-vision contrast, Tonight and card calm, grouped Explore, star page, two badge styles | **Built and validated, awaiting developer review**: design approved 2026-11-10 (spec `docs/superpowers/specs/2026-11-10-polish-pass-2-design.md`); dark-room check of night vision pending |
| 5 | Scientific image analysis | FITS photometry, user-generated light curves | Planned, after the polish pass |
| 6 | Advanced features | Personalization, collaboration, 3D visualization, telescope integrations | Not started |

> The original build brief (`ASTROPLANNER_SPEC.md`) numbered AstroLog "Phase 1.1",
> the Research Lab "Phase 1.2" and image analysis "Phase 2". **This roadmap supersedes
> that numbering**; the spec remains the source of truth for accuracy standards.

## How each phase is run

Every phase is split into three activities, **Design → Build → Validate**, with a git
recovery point between each. Implementation never starts before the Design gate.

**0. Use it first.** Before designing a phase, the developer uses the app for a real night
with the Seestar S30 and notes what felt missing or confusing. Those notes are the first
input to Design.

**Design:** explore ideas, decide features, prototype interfaces.
1. **Review** the existing codebase and completed functionality.
2. **Brainstorm and refine** features and user experience together.
3. **Show usable screen designs early.** Mockups or clickable prototypes of every new screen,
   in the app's real theme (and night vision), are reviewed *before* the implementation plan.
   The visual presentation is part of the product, not a finishing step.
4. **Propose** the technical implementation and dependencies, and **identify risks**
   (scientific, technical, architectural, licensing).
5. **Present** the written spec and implementation plan with acceptance criteria.
6. **Wait for approval** from the developer. ⛔ Gate. The approved spec, plan and mockups
   are committed (recovery point: "design approved").

**Build:** implement approved features in manageable increments.
7. **Build incrementally** in small milestones. Each milestone ends with working code, its
   automated tests passing, and a commit, so any later problem can be rolled back to it.
   UI milestones come early enough that the developer can try real screens mid-phase.

**Validate:** test calculations, functionality, UI and regressions.
8. **Test** all features and **verify scientific calculations** against independent references;
   run every suite (backend, unit, end-to-end) and check the UI in the browser on desktop,
   mobile and night vision.
9. **Preserve** earlier phases: all previous test suites stay green.
10. **Update documentation** (`README.md`, `docs/`, `PROGRESS.md`, this roadmap), then developer
    review, merge, and a `phase-N` git tag as the phase's recovery point.

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
- Variable Hunter prerequisite before going public: the four stars' VSX catalog facts are used under VSX's
  "personal, non-commercial use only" terms, so a public site needs AAVSO's permission for them (or drop them).
- Sky image prerequisite before going public: DSS is copyrighted and free only for non-profit use, and its terms do not address
  caching, so re-check with STScI or set `ASTROPLANNER_SKY_IMAGES=off`. Survey images are never committed to this public repository.
- To re-check at that time: Vercel Python function size/cold start with Astropy, whether
  Phase 4 processing needs a different compute target, Open-Meteo terms for the use case.
- Meanwhile every phase must keep the `DATABASE_URL` seam working (no SQLite-only SQL).

## Later phases: direction only (not yet requirements)

These notes record intent and the questions each phase must answer in its own steps 1–5.
Nothing here is approved for implementation.

### Phase 3: Variable Hunter (built; see the status table above)
- Original intent: curated variable-star research and AstroMissions linking targets, sessions and goals.
- Questions to settle: what AAVSO/VSX data can be used under their terms and through which
  documented interface (no scraping); ephemeris validation before showing any prediction
  window; which targets are realistic for a 30 mm aperture.

### Phase 4: Processing Coach (built; see the status table above)
- Intent: turn "I followed a tutorial" into knowing which Siril settings fit a night's frames, step by step,
  with every recommendation traceable to Siril's measurements or labelled as a default or taste.

### Phase 5: Scientific image analysis (was Phase 4 until 2026-11-03)
- Intent: FITS import, differential aperture photometry (photutils), user light curves.
- Questions to settle: S30 colour-sensor and filter limitations, calibration requirements,
  uncertainty propagation, and clear "instrumental, not standardised" labelling.

### Phase 6: Advanced features (was Phase 5)
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
| Pluggable data providers injected via `app.state` (weather today) | `backend/app/main.py`, `weather.py` | A Phase 3 AAVSO provider used this pattern (removed before merge; see branch `aavso-live-layer`) |
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
| 2026-11-02 | **AAVSO observation layer is off by default** (`ASTROPLANNER_AAVSO_ENABLED=1` to switch on); without it the app shows a VSX link and no curve or alerts | Gate G1: AAVSO's Data Usage Guidelines and API docs are unread (Cloudflare blocks automated readers); local use is a developer decision |
| 2026-11-02 | VSX's copyright page permits personal, non-commercial use only and forbids mirroring on another server; only `vsx.aavso.org` is called, sequentially, at least 2 s apart | Read 2026-11-02; keeps local use inside the stated terms |
| 2026-11-02 | **Public deployment needs AAVSO's written permission**, plus a keyed observer-hash and multi-process request locking | Terms above; recorded in the deployment prerequisites |
| 2026-11-02 | Observer name, country, comment, charts and code are never stored; the code is kept only as a salted hash to count distinct observers | Privacy of third-party observers; tested with sentinel values |
| 2026-11-02 | No predictions in Variable Hunter (no eruption dates, countdowns, "expected" text); alerts need independent observers and show data freshness | Predicted T CrB dates have lapsed; stale data must never read as "no change" |
| 2026-11-02 | S30 brightness limits (7 to 12.5) are an estimate, labelled "estimate, not yet measured" | Only one S50 owner data point exists |
| 2026-11-02 | **Phase 3 complete pending developer review** on branch `phase-3-variable-hunter` | Suites green (303 backend, 117 unit, 24 e2e); local live check passed |
| 2026-11-03 | **Live AAVSO observation layer removed from Phase 3** (light curves, sky alerts, outburst mission, observation cache, migration 0005); preserved on branch `aavso-live-layer`. Star pages link to AAVSO VSX instead | Gate G1 outcome: VSX copyright, the Data Usage Guidelines (2026-07-16) and AAVSO's forum API notes were read; none covers a third-party app downloading and showing AID observations (`api.delim` is undocumented). Developer chose removal over emailing AAVSO; Phase 4's own measurements make it unnecessary |
| 2026-11-03 | **Phases run as Design → Build → Validate**, with a commit at every milestone, usable screen designs shown before the implementation plan, and a real night with the S30 before each phase's design | Developer direction (from outside advice): recovery points between milestones, and the UI is part of the product |
| 2026-11-03 | **Phase 3 merged** (PR #2) and tagged `phase-3` | Developer review; CI green on the merge commit |
| 2026-11-03 | **Phase 4 is the Processing Coach; photometry moves to Phase 5, advanced features to Phase 6** | Developer's real S30 night (Bubble Nebula): they image deep-sky targets and re-stack in Siril by following a tutorial; their goal is to know which settings to use. Photometry stays planned, one phase later |
| 2026-11-03 | **Siril does the measuring**: per-frame statistics come from Siril's `.seq` files, read as text in the browser; raw frames are never read | Numbers the developer can find in Siril; no re-implementation of Siril |
| 2026-11-03 | **Finished stacks (not raws) may be sent to the local backend**, measured in memory and not stored; only previews and numbers are kept | Developer decision; extends the Phase 2 "image data never leaves the disk" rule for stacks only. Re-check against hosting limits before deployment |
| 2026-11-03 | **Phase 4 complete pending developer review** on branch `phase-4-processing-coach` | Suites green (379 backend, 121 unit, 18 e2e); local Siril 1.4.5 run on the real night passed. Open: Seestar stacked FITS for the measured comparison (G2) |
| 2026-11-04 | **Phase 4 merged** (PR #3, `20bb73d`) and tagged `phase-4` | Developer review; CI green on the merged commit (backend incl. Postgres migration, frontend, e2e). Final suites: 416 backend (12 skipped), 129 unit, 18 e2e |
| 2026-11-09 | **Polish pass comes before Phase 5**; Tonight leads with the score tied to what it covers plus a plain statement of the whole night | Developer direction after a whole-app audit: 100/100 on a night going overcast misled at a glance. Direction B chosen from a clickable prototype |
| 2026-11-09 | **Target cards use DSS red-plate sky images**, fetched once and cached locally, with a framing diagram as the fallback | Developer choice. Terms read 2026-11-09 allow non-profit use with acknowledgment; colour DSS needs a separate request; no openly licensed colour survey covers all 58 targets |
| 2026-11-09 | **No new motion or sheet dependency**; the phone sheet is built on the native `<dialog>` | Vaul's README says it is unmaintained; CSS transitions and direct transform writes cover what the design needs |
| 2026-11-10 | **Homescreen landing page at `/`; Tonight moves to `/tonight`** (branch `worktree-landing-page`, merged after the polish pass) | Developer wants newcomers, beginner or experienced, to get the story and see the app first ("like the OpenAI homepage"). Chose mockup B v2: headline first, then their own Andromeda photo, one night scrolled through the app, real captures, city box. Suites after merging the polish pass: 453 backend (12 skipped), 276 unit, 36 e2e (2 skipped) |
| 2026-11-10 | **Inter stays, tuned** (optical-size file, a type scale with tracking per size); not Geist or the system font | Developer choice after the pass 2 audit. design-taste-frontend section 4.1 discourages Inter as a default; the developer chose to keep it and tune it |
| 2026-11-10 | **Night-vision levels: ink `#ee5a4b`, ink-2 and muted `#d24c3f`, accent `#ff5a47`** | Every text token at least 4.5:1 on night, night-deep and panel-2; two distinct levels need some green (channel 90), so the reds read slightly orange. Pending the dark-room check |
| 2026-11-10 | **En-dashes stay in ranges; em-dashes are removed** | design-taste-frontend bans en-dashes as separators, but that targets decorative dashes in marketing copy; a range dash is correct typography. The three em-dashes became an en-dash placeholder and a colon |
| 2026-11-10 | **The S30 FOV-axis caveat is stated once per surface**, not on every card | Requirement 5 needs the caveat wherever framing notes appear; repeating it on every card is noise. The sentence is built from the equipment name and `fov_deg` |
| 2026-11-10 | **The framing-diagram fallback shows no caption**; only sky images show the field width | Labelling the dashed circle with a width would imply an FOV axis that is unverified |
| 2026-11-10 | **Site pages live outside the app shell, sharing the homescreen header and footer** | How it works, Privacy, Credits and Terms are reference pages, not tools, so they get the landing layout and no app navigation. Terms is a plain-language draft, Privacy covers the local app only, and the account section waits for the login design |
