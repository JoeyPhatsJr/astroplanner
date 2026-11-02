# CLAUDE.md — AstroPlanner working instructions

Read `ASTROPLANNER_SPEC.md` before changing anything. The spec is the source of truth for product scope, accuracy standards, and phases.

## Goal
Build a working, beautiful astrophotography planner with research features layered in later. Do Phase 1 first. Do not attempt image photometry, telescope control, community/social, payments, or fictional event calendars in the first milestone.

## Technology baseline
- Frontend: React, TypeScript, Vite, Tailwind; use accessible UI primitives, charts for real time series.
- Backend: Python, FastAPI, Pydantic, Astropy/astroplan where appropriate.
- MVP persistence: SQLite (SQLAlchemy/Alembic or equivalent simple, documented approach).
- Tests: pytest on computation, Vitest on frontend logic, Playwright smoke tests if environment supports it.
- Organize into `/frontend` and `/backend`; provide one clear local run workflow.

## Nonnegotiable requirements
1. Computed astronomical facts must be based on actual observer latitude/longitude/time and reliable algorithms.
2. Convert using UTC internally and display in the *observer's* IANA timezone; evening-to-morning night boundary matters.
3. Actual weather forecasts must include source, update time, and missing-data states; do not render dummy data as live.
4. Show uncertainty/heuristic labels for 0–100 scores, and explain which factors drove recommendations.
5. Verified Seestar S30 preset: original S30, NOT S30 Pro. Published: 30mm aperture, 150mm focal length, tele FOV 2.46° (dimension unspecified). Don't assume 2.46° equals horizontal/vertical FOV.
6. Respect external licenses, source attribution, API rate limits, and noncommercial-use terms.
7. Research Lab should start with curated variable-star missions and authoritative links; no invented AAVSO chart data or scientific discoveries.
8. Responsive layout, proper loading/error/empty states, accessible input labels.
9. No dead buttons, fake observations, misleading celestial calculations, or claimed tests that were not run.
10. Maintain `PROGRESS.md` with milestones, limitations, and the exact next step.

## Build workflow
1. Inspect the existing repo, if any; do not overwrite user work.
2. Summarize Phase 1 plan briefly and start implementing it.
3. Create framework/setup and a coherent but modest UI shell.
4. Build location/equipment settings + persistence.
5. Add target catalog and astronomical visibility API with tests.
6. Add weather API adapter + error handling/cache.
7. Implement transparent conditions and target scoring, then charts and cards.
8. Add session plan persistence.
9. Run tests, fix failures, and document how to run the app.
10. Stop at a working Phase 1; ask the developer whether to proceed to AstroLog or Research Lab next.

When uncertain, prefer a correct, explicit limitation over fabricated data. After each implementation increment, report files changed, commands executed, tests and current next step. Be skeptical of algorithms that mix moon phase, target altitude, and cloud cover into unsupported claims of precise sky quality.
