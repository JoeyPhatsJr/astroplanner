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
| `catalog.py` + `app/data/variables.json` | The four curated stars (VSX catalog facts, missions, period notes). Stars never enter the DSO catalog, so Phase 1 recommendations and scores are unchanged |
| `missions.py`, `fit.py` | Mission progress from AstroLog nights; S30 fit text from an estimated magnitude range |
| `routes.py` | `GET /api/variables` (list), `/api/variables/{slug}` (detail), `/api/variables/{slug}/visibility`; no database tables of its own |

The catalog facts come from VSX's `api.object`, fetched once by `backend/scripts/build_variables.py` (sequential,
at least 2 s apart, identifying user agent) and committed as `variables.json`. At runtime the app makes **no AAVSO
requests**. A live observation layer (VSX `api.delim` provider, observation cache, light curves, sky alerts) was
built and removed before merge because no AAVSO terms cover a third-party app downloading and showing AID
observations; it is preserved on the `aavso-live-layer` branch (including its migration `0005_variable_hunter`).

## Processing Coach (Phase 4)

Package `backend/app/processing/`; page `frontend/src/pages/ProcessingCoachPage.tsx`; methods and constants in
[PROCESSING.md](PROCESSING.md).

| Module | Role |
|---|---|
| `models.py` | Table `processing_runs` (migration `0005_processing_runs`): one run per capture set, with the saved night report, frame statistics, the user's choices and the comparison entries |
| `seq.py` | Reader for Siril `.seq` and `*_conversion.txt` text (versions it knows; anything else is refused with a message) |
| `report.py` | Night report: totals, half-hour bins in the night's IANA timezone, fixed-rule findings, optional low-altitude cause (Astropy) |
| `selection.py` | Frame options with exact counts, following Siril's own filter rules |
| `scripts.py` | The two generated `.ssf` scripts and their disk estimates (golden files in `tests/golden/`) |
| `measure.py` | `coach-measure-2`: star size, noise, gradient and colour of a finished stack FITS, plus two metadata-free JPEGs |
| `rules.py`, `steps.py` | Advice rules (each with a `basis` and a heuristic flag) and the ten-step skeleton |
| `routes.py` | `/api/processing/runs` (create, read, patch, folder, scripts, stacks, pictures, images) |

Flow:

```
browser                                              backend
  pick night folder
  read ONLY *.seq and *_conversion.txt (text) ──►  POST /runs/{id}/siril-folder
                                                     match frames to the AstroLog night by basename, build report
  report, options, advice                       ◄──  (absolute paths dropped; only basenames and the folder name kept)
  choose frames                                 ──►  PATCH /runs/{id}  (choices.selection)
  download scripts                              ◄──  GET  /runs/{id}/scripts/{prepare|stack}
  add finished stack (FITS)                     ──►  POST /runs/{id}/stacks/{side}
                                                     measure in memory; keep numbers + two small JPEGs
```

Rules specific to this phase: Siril does the measuring (the app reads its text output and never opens light frames);
the generated scripts write only into `process-coach/` beside `lights/` and begin with `requires 1.4.5`; a measured
stack's FITS and header values (including any site coordinates) are never stored or returned; measurements carry a
method version and are never compared across versions; every recommendation names its basis (measured, Siril's
documentation, tutorial default, or taste) and nothing is scored. Stacks, not raw frames, are the only image data
that reaches the backend, and only when the user adds one; this extends the Phase 2 rule for stacks only and must be
re-checked against hosting limits before any deployment.

## Polish pass (2026-11)

- **`night_clear`** (`scoring.py`): the longest run of darkness samples whose forecast is clear, using the same rule as a
  target's favorable window (cloud and precipitation-probability limits). Missing forecast values never count as clear; it is
  `null` without a forecast, without darkness or without a clear sample. It is a statement about the whole night
  ("Clear until about 02:30") shown beside the Tonight's Score, and it does not change how any score is calculated.
- **Sky images** (`sky_images.py`, `GET /api/targets/{id}/sky-image`): a `SkyImageProvider` on `app.state.sky_images` fetches a
  Digitized Sky Survey cutout from STScI at most once per target and field size, reduces it to a small greyscale JPEG and caches it
  under `backend/data/sky-images/` (ignored by version control). Requests are serialised and spaced out, failures back off, and nothing is
  fetched when the switch is off (`ASTROPLANNER_SKY_IMAGES=off`; the route then answers 503). The card keeps the framing diagram as its
  fallback and fades the picture in over it. Tests inject a fake fetcher, so none touches the network.
- **Overlay and sheet** (`ui/Overlay.tsx`, `ui/useSheetDrag.ts`, `lib/sheetDrag.ts`): one native `<dialog>` (focus trap, Esc, inert page)
  with a real scrim and panel, shared timing (in 280 ms, out 200 ms; modal 180/120), `data-state` open or closing. On phones a drawer is a
  bottom sheet: the grabber and header are the drag region, the drag writes `transform` and scrim `opacity` straight to styles
  (no React state or CSS variables), and releasing hands control back to the stylesheet transitions. A closing sheet can be caught mid-flight.
- **Themed controls** (`ui/Select.tsx`, `ui/NightPicker.tsx`, popups built on Base UI): selects and the date picker are drawn from the palette
  variables, so night vision keeps them red. Checkboxes and radios are drawn in `index.css` for the same reason (the native tick is white).
  Ten native `<select>` elements remain; their open list is drawn by the browser.
- **Night vision**: `:root[data-vision="night"]` redefines every colour token; pictures go through the red-channel-only SVG filter `#vision-red`.
  Entering night vision is instant; leaving it crossfades over 200 ms (View Transitions, skipped under reduced motion).

## Persistence

- Phase 1 tables: `observing_locations`, `equipment_profiles`, `sessions`,
  `session_targets`. Phase 2 adds the AstroLog tables above plus an `app_meta` table
  (one-time seeding flags such as the Canon profile).
- **Migrations are Alembic** (`backend/migrations/versions/`): `0001_phase1_baseline`,
  `0002_astrolog`, `0003_library_target_coords`, `0004_capture_exif` (Canon ISO / f-number /
  focal length per frame, lens per capture set; all nullable), `0005_processing_runs` (Phase 4). The app upgrades to head at startup, and an
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
