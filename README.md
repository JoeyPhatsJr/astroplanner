# AstroPlanner

**Explore. Capture. Discover.** An astrophotography planner built around one question:
*which targets will actually be above my horizon during real darkness tonight, and when?*
It is tuned first for the **ZWO Seestar S30** (original, not the S30 Pro).

![Tonight dashboard](docs/screenshots/tonight-desktop.png)

## What it does (Phase 1)

- **Tonight:** a 0–100 **Tonight's Score** with every component shown (cloud 45, rain 25,
  Moon 20, darkness 10), whether each is *forecast* or *calculated*, and the best 2-hour
  window. The dusk-to-dawn timeline shows twilight bands, Moon altitude and hourly cloud and
  precipitation. With no forecast, there is **no total**, only clearly labelled partial
  indicators.
- **Recommendations:** 58 deep-sky targets from OpenNGC, ranked by a transparent heuristic.
  Each shows its real observing window, peak altitude, Moon separation, 2–4 reasons and
  cautions (including S30 framing notes).
- **Explore:** search and filter the full catalog. A detail drawer shows the
  altitude-vs-local-time chart, coordinates, rise/set and the score breakdown.
- **Sessions:** create a plan for a night; add, reorder and remove targets; it persists in the database.
- **Settings:** city search or manual coordinates with timezone detection (opt-in browser
  geolocation), the read-only **verified S30 preset** plus custom equipment, and observing
  preferences (minimum altitude, astronomical vs nautical darkness).
- **Research Lab / AstroLog:** honest previews of later phases (no fake data or controls).

## Accuracy

All astronomy runs on the backend with **Astropy** and is checked in CI against independent
references (US Naval Observatory sunrise/sunset/twilight/moonrise data across both 2026 DST
transitions, a southern-hemisphere case and a midnight-sun case; USNO Moon phases; Meeus
Example 13.b). See [docs/ASTRONOMY.md](docs/ASTRONOMY.md) and [docs/SCORING.md](docs/SCORING.md).

## Run locally

Requirements: **Python 3.11+** (Astropy 8) and **Node 20+**.

```bash
./scripts/setup.sh     # creates backend/.venv, installs Python + npm dependencies
./scripts/dev.sh       # API on :8000, app on http://127.0.0.1:5173
```

No API keys or environment variables are needed for the local prototype.

Or run the pieces yourself:

```bash
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000   # API + docs at /docs
cd frontend && npm run dev                                          # Vite, proxies /api
```

Single-process mode: after `npm run build`, the backend also serves `frontend/dist`
(`uvicorn app.main:app` → http://127.0.0.1:8000).

Optional environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | unset → SQLite at `backend/data/astroplanner.db` | Postgres (e.g. Supabase) connection string |
| `ASTROPLANNER_DB` | `backend/data/astroplanner.db` | SQLite path when `DATABASE_URL` is unset |
| `ASTROPLANNER_CORS` | `http://localhost:5173,http://127.0.0.1:5173` | Allowed browser origins |

## Tests

```bash
cd backend && .venv/bin/python -m pytest -q        # 66 tests: astronomy references, DST, scoring, weather, API
cd frontend && npm run typecheck && npm test       # 23 tests: timezone/DST formatting, RA/Dec, components
cd frontend && npm run build
cd frontend && npx playwright install chromium && npm run test:e2e   # 8 end-to-end smoke tests (desktop + mobile)
```

The end-to-end suite starts its own backend (fresh SQLite file) and Vite server on ports
8100/5180, so it never touches your dev servers or data.

Development follows the phased plan in [ROADMAP.md](ROADMAP.md); current status is in [PROGRESS.md](PROGRESS.md).

## Project layout

```
backend/   FastAPI + Astropy API (app/), tests/, scripts/build_catalog.py
frontend/  React + TypeScript + Vite + Tailwind UI
docs/      ARCHITECTURE.md · ASTRONOMY.md · SCORING.md · screenshots/
scripts/   setup.sh · dev.sh
```

## Data sources and licenses

- **OpenNGC** (CC BY-SA 4.0): target coordinates, types, sizes, magnitudes. The derived
  `targets.json` is CC BY-SA 4.0; see [backend/app/data/ATTRIBUTION.md](backend/app/data/ATTRIBUTION.md).
- **Open-Meteo** Forecast and Geocoding APIs (data CC BY 4.0). The free tier is for
  **non-commercial use only**; review its terms before any commercial use.
- **Astropy** (BSD-3-Clause), **timezonefinder** (MIT).
- Seestar S30 specifications: [manufacturer product page](https://us.seestar.com/products/seestar-s30-all-in-one-smart-telescope).
  The published 2.46° FOV does not state its axis, so framing notes are approximate.

Scores are heuristic planning estimates, not measurements of sky quality, transparency or seeing.
