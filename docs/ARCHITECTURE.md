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
│   └─ db.py         SQLAlchemy models: locations, equipment,     │
│                    sessions, session_targets                    │
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

## Persistence

- Tables: `observing_locations`, `equipment_profiles`, `sessions`,
  `session_targets` (spec §6, Phase 1 subset only).
- Schema creation is `metadata.create_all` (idempotent) plus an idempotent
  `seed()`. Alembic migrations should be introduced with the first schema change
  after Phase 1 (AstroLog will add columns/tables).
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
