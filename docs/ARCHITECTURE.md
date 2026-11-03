# Architecture

```
┌──────────────────────────── browser ────────────────────────────┐
│ React + TypeScript (Vite, Tailwind, TanStack Query, Recharts)   │
│  • formats times in the observer's IANA timezone (Intl API)     │
│  • never computes astronomy — renders what the API returns      │
└───────────────────────────────┬─────────────────────────────────┘
                                │ JSON over /api
┌───────────────────────────────▼─────────────────────────────────┐
│ FastAPI (backend/app)                                           │
│  api.py ─ routes, validation (Pydantic), dependency injection   │
│   ├─ astronomy.py  Sun/Moon/targets on a 5-min UTC grid (Astropy)│
│   ├─ intervals.py  threshold crossings + window intersection    │
│   ├─ visibility.py per-target windows, status, explanations     │
│   ├─ scoring.py    Tonight's Score + target score (heuristics)  │
│   ├─ weather.py    Open-Meteo adapter, cache, grid alignment    │
│   ├─ geo.py        place search (Open-Meteo), timezone lookup   │
│   ├─ catalog.py    58 OpenNGC-derived targets (targets.json)    │
│   ├─ db.py         SQLAlchemy models: locations, equipment,     │
│   │                sessions, session_targets                    │
│   └─ astrolog/     Phase 2: headers, importer, library,         │
│                    previews, storage, routes (/api/astrolog)    │
└──────────────┬──────────────────────────────┬───────────────────┘
               │                              │
      SQLite (local dev)            Open-Meteo Forecast / Geocoding
      Postgres via DATABASE_URL     (non-commercial free tier)
      (Supabase in production)
```

## Key design decisions

1. **One source of astronomical truth.** All positions and windows come from
   the Python backend (Astropy). The frontend only formats; there is no second
   JavaScript implementation to drift out of sync.
2. **Night-centric, UTC-internal time model.** A night is local noon → noon,
   converted to UTC once; everything else is UNIX seconds on a uniform 5-minute
   grid. DST is handled by construction, not special cases.
3. **Vectorised, cached sky context.** One Astropy transform computes all 58
   targets × 289 samples (~0.6 s). `sky_context` is memoised per
   (location, night), so recommendations, detail views and the Tonight page
   share one computation (subsequent requests ≈ 20 ms).
4. **Weather is optional by design.** The weather adapter returns an explicit
   status (`ok | unavailable | error`) with a reason; scoring degrades to
   calculation-only indicators instead of inventing values. Providers are
   injected (`app.state.weather`) so tests use deterministic stubs.
5. **Transparent scores.** Every score is a list of components with points,
   maximum, basis (forecast/calculated) and an explanation. See `SCORING.md`.
6. **Verified presets are immutable.** The Seestar S30 preset is re-seeded on
   startup and rejected by PATCH/DELETE (403); users duplicate it to customise.

## AstroLog (Phase 2)

Package `backend/app/astrolog/`:

| Module | Role |
|---|---|
| `headers.py` | Parses FITS header slices (Astropy) and CR2 EXIF slices (exifread); classifies sub / stack / other; filename fallbacks |
| `importer.py` | Preview and commit: grouping, night assignment, location matching, dedup, plan attachment |
| `library.py` | Library, target page, history badge data; headline and "% used" rules |
| `previews.py` | Final-picture decode (Pillow / tifffile / Astropy), 1600 px preview + 400 px thumbnail, metadata-free |
| `storage.py` | Small storage interface; `LocalStorage` writes under `ASTROPLANNER_PREVIEWS_DIR` (default `backend/data/previews/`, gitignored). Supabase Storage can implement it later |
| `models.py`, `routes.py` | Tables `library_targets`, `capture_sets`, `capture_frames`, `stacks`, `final_images`; routes under `/api/astrolog` |

Import flow:

```
browser                                         backend
  pick / drop folder
  classify by path (ignore process/, pp_, r_, .seq, .txt, .mp4 ...)
  slice headers only (FITS: 2880-byte blocks to END, max 10;
                      CR2: first 128 KB)          ──► POST /import/preview   (batches of 300)
                                                      parse, match saved location (≤ 5 km),
  review screen: groups, frames, new vs known    ◄──  assign night, dedup against the database
  (needs_location → pick a saved location)
  confirm                                         ──► POST /import/commit
                                                      insert only new frames/stacks, attach to
  open the target page                           ◄──  a plan if one matches
```

Image data never leaves the disk: the browser sends header bytes only. The single uploaded
image is the optional final picture (`POST /targets/{id}/final-image`), from which the backend
stores a metadata-free preview and thumbnail.

**Privacy rule.** Coordinates read from files (`SITELAT`/`SITELONG`) are used only inside the
request to pick the timezone and match a saved location. They are never stored, returned,
logged or written into previews. The one sanctioned exception is `POST /import/suggest-location`,
called only when the user asks to create a location from the file; it returns coordinates
rounded to 0.01 degrees. Tests check preview/commit/library responses and preview bytes for the
header coordinates.

Other rules: unknown values stay `null` and the UI says "unknown"; stack times are never summed
(headline = the stack linked to the current final picture, else the latest stack for a target with
no frames, else captured time labelled "captured"); a re-import never moves already-imported frames
(corrections go through `PATCH /targets/{id}`); imported observations are never deleted as a side effect
(foreign keys are RESTRICT, and deleting a session that has capture sets returns 409).

## Variable Hunter (Phase 3)

Package `backend/app/variables/`:

| Module | Role |
|---|---|
| `catalog.py` + `app/data/variables.json` | The four curated stars (VSX facts, alert rule, missions, history windows). Stars never enter the DSO catalog, so Phase 1 recommendations and scores are unchanged |
| `aavso.py` | Providers behind one protocol: `VsxProvider` (`vsx.aavso.org` `api.delim` only, sequential, >= 2 s apart process-wide, honest user agent, no redirects) and `FixtureProvider` (synthetic CSV files, for e2e) |
| `cache.py` | Observation cache and the two fetch paths (3-day alert window; 365-day history in 30-day chunks, oldest first, resumable); de-duplicates on `(star_id, obsID)`; logs every request in `variable_fetches`; failure back-off |
| `curve.py` | Which observations count (positive V and visual detections only), daily means, thinning, outburst windows, the background history fill |
| `alerts.py` | Alert rule and episodes: freshness first (`unavailable` / `stale`), then `alert` or `no_change`; dismissal stores the episode start |
| `missions.py`, `fit.py` | Mission progress from AstroLog nights; S30 fit text from an estimated magnitude range |
| `models.py`, `routes.py` | Tables `variable_observations`, `variable_fetches`, `variable_alert_dismissals` (migration `0005_variable_hunter`); routes under `/api/variables` |

Flow (AAVSO on):

```
Tonight / menu dot ─► GET /api/variables/alerts ─► refresh 3-day window per star (provider, then cache)
                                                    ─► alerts.current(cache only) ─► state + evidence + freshness
Star page          ─► GET /api/variables/{slug}/curve ─► answer from the cache at once;
                                                    background task fills missing history chunks;
                                                    the page polls and shows "Loading history: n/365 days"
```

The provider is chosen at startup: `ASTROPLANNER_AAVSO_FIXTURE_DIR` (fixture) beats `ASTROPLANNER_AAVSO_ENABLED=1`
(live); with neither, `app.state.aavso` is `None` and the API reports `aavso.enabled = false` (fallback: the page
shows a VSX link, Tonight shows no alerts card, `/curve` answers 409). Tests inject stub providers and never use the network.

**Privacy rule.** The AAVSO CSV carries each observer's full name, country, comments and chart IDs. Parsing keeps
only `obsID, JD, mag, uncert, band, fainterThan, obsType, val` and turns the observer code into a salted hash
immediately; names, countries, comments, charts and codes are never stored, returned or logged. The hash exists only
to count *distinct* observers and is never returned. It is pseudonymisation, not anonymity (a keyed hash is a
pre-deployment item). Tests plant sentinel values in the fixtures and search every response, database row and log line.

## Persistence

- Phase 1 tables: `observing_locations`, `equipment_profiles`, `sessions`,
  `session_targets`. Phase 2 adds the AstroLog tables above plus an `app_meta` table
  (one-time seeding flags such as the Canon profile).
- **Migrations are Alembic** (`backend/migrations/versions/`): `0001_phase1_baseline`,
  `0002_astrolog`, `0003_library_target_coords`, `0004_capture_exif` (Canon ISO / f-number /
  focal length per frame, lens per capture set; all nullable), `0005_variable_hunter` (observation cache, fetch log, alert dismissals). The app upgrades to head at startup, and an
  existing Phase 1 database (no version table) is stamped at the baseline first. Migrations are
  written for both SQLite and Postgres; a test runs them on Postgres when `TEST_POSTGRES_URL` is set.
  Revisions are hand-written (no autogenerate), and a test compares the ORM schema with the migrated one.
- UI preferences (selected location/equipment/night, min altitude, darkness)
  live in browser `localStorage`; entities live in the database.

## Deployment plan (next milestone — not yet deployed)

Target: **Vercel** (frontend + Python function) and **Supabase** (Postgres + Auth).

| Piece | Plan | Status |
|---|---|---|
| Frontend | Static Vite build on Vercel | prepared (`npm run build`) |
| API | FastAPI as a Vercel Python function (ASGI) | to verify: bundle size (Astropy + NumPy + timezone data) and cold start |
| Database | Supabase Postgres via `DATABASE_URL` (psycopg 3, `pool_pre_ping`) | code supports it; not yet run against Supabase |
| Auth | Supabase Auth; backend verifies the JWT and restricts writes to the owner | **required before public deploy**: without it anyone with the URL could edit sessions |
| Weather cache | in-process (per function instance); acceptable at single-user volume | could move to a Postgres table if rate limits matter |

SQLite must not be used on Vercel (ephemeral filesystem).
