# AstroPlanner — Product & Engineering Specification

**Status:** proposed build brief • **Version:** 0.1 • **Prepared:** 2026-11-02

**Tagline:** Explore. Capture. Discover.

> One connected astrophotography experience: find what is worthwhile to observe, plan a realistic session, retain the results, and eventually conduct introductory variable-star research.

## 1. Product decision

Build **one application**, not two independent apps:

- **Tonight** — a clear, explainable session forecast and target recommendations.
- **Explore** — discover objects and view when they are photographable with the user's equipment.
- **Research Lab** — initially browse and plan variable-star observation missions; later upload suitable images and measure brightness.
- **AstroLog** — personal sessions, images, notes, and eventual measurements.
- **AstroMissions** — a shared workflow connecting these sections (photography missions and science missions).

**First target persona:** individual amateur astrophotographer who uses a Seestar S30, with an extensible architecture for other equipment. **Initial platform:** responsive desktop-first web app, usable on mobile. **MVP objective:** the app must tell a user *which targets will actually be above their observing horizon during dark hours tonight*, give a sensible window for each, and clearly distinguish forecast-derived conditions from calculated astronomical positions.

## 2. What makes it distinctive

- Equipment-aware observing recommendations, not a generic list of visible stars.
- Transparent conditions rating showing evidence and uncertainties, never a mysterious AI-derived score.
- End-to-end workflow: select target → save planned session → log actual results → optionally create a research mission.
- A route from accessible astrophotography to **real photometric analysis**, without pretending uncalibrated images constitute scientific measurements.
- Longer-term differentiator: learn from a user's own session outcomes and, later, accommodate local obstructions/window geometry (SkyTwin concept).

## 3. Scope and implementation order

### Phase 1: working MVP — DO THIS FIRST

1. Responsive application shell with Tonight, Explore, Research Lab (preview/limited view), AstroLog (preview/limited view), Settings.
2. Manual observing location input (city lookup or coordinates), timezone, saved location; browser geolocation is opt-in. Include a default **editable sample location**, clearly labeled as sample. Never assume the user's exact location.
3. Equipment profile selector with verified **Seestar S30** preset and a custom telescope option. Store aperture/focal length/FOV metadata and distinguish validated from approximate parameters.
4. Real forecast retrieval, with proper loading/error/no-data/last-updated state.
5. Accurate Sun, Moon, and target coordinates and local-night timeline. Use real astronomical calculations; no invented rise/set times.
6. A **Tonight's Score 0–100** with a documented, editable heuristic and component breakdown. State this is a planning estimate, not a measured sky-quality index.
7. Curated target catalog of at least 20 deep-sky objects (nebulae, galaxies, clusters), with trustworthy source coordinates and distinct object IDs.
8. **What Can I See?** ranked, filterable target cards with actual observability information and an **altitude-versus-local-time** graph.
9. Target detail panel: type, identifiers, coordinates, altitude graph, Moon angular separation, best forecast-adjusted observation window, and a prominent “Add to Session” action.
10. Basic session planning: create a session, add/reorder/remove targets, save it, and preserve it across reloads.
11. Deterministic astronomy and scoring tests; responsive layouts; README instructions to run the app locally.

### Phase 1.1: AstroLog

- Mark a session completed; store actual start/end, imaging time, notes, equipment, location, target IDs, and optional images.
- View historical sessions by date/target; simple image gallery; protect local paths and upload size.

### Phase 1.2: Research Lab + AstroMissions

- Browse a **small, explicitly curated** variable-star catalog containing source identifiers, RA/Dec, variability types, and dependable references.
- Show actual target visibility and suitable observation windows; attach a research mission to a planned session.
- Display **real AAVSO published/historical light-curve data where authorized and technically feasible**. In the absence of a documented suitable integration, link to the official AAVSO data view rather than scraping or fabricating data.
- Science mission example: “Observe a suitable eclipsing binary over a predicted brightness change.” Only offer specific prediction windows after proper ephemeris validation; target selection must reflect equipment sensitivity and cadence.
- Educate users about differential photometry, comparison stars, saturation, calibration, and uncertainties.

### Phase 2: image analysis and variable-star photometry

- FITS import (not only stacked JPEG); inspect header metadata and timestamps; reject unsupported or insufficient data with useful messages.
- Differential aperture photometry with photutils using target and comparison/check stars, local sky background, bad-pixel/saturation rejection, uncertainties, and time-series light curves.
- Support appropriate calibration and document limitations of the S30 color camera and filter response.
- Never label an automatically generated result as “scientifically validated” or “a discovery.”

### Future / explicitly out of scope for initial build

- Direct telescope control and undocumented Seestar integrations.
- AI anomaly discovery claims, field-rotation compensation control, advanced plate-solving, automatic mosaic scheduling.
- User accounts/cloud sync/social features, live community feeds, subscriptions/payments.
- Meteor-shower and conjunction event feeds until maintained, authoritative data feeds are selected. An Upcoming Opportunities navigation placeholder is acceptable, but **no invented dates or alerts**.
- Claims of real-time sky transparency or atmospheric seeing without suitable data.

## 4. Recommended stack

| Layer | Recommended choice | Why |
|---|---|---|
| Web frontend | React + TypeScript + Vite | Fast iteration, reusable typed components |
| Styling | Tailwind CSS + accessible component primitives | Consistent responsive dashboard |
| Charts | Recharts or visx | Altitude/weather time-series plots |
| API/backend | Python + FastAPI + Pydantic | Integrates cleanly with scientific Python |
| Astronomy | Astropy coordinates/time, optionally astroplan | Tested celestial coordinate transformations |
| Weather | Open-Meteo Forecast API (noncommercial prototype) | Hourly cloud, precipitation, wind, humidity, visibility |
| Data persistence | SQLite via SQLAlchemy and Alembic | Local MVP without authentication and infrastructure |
| Quality | pytest + Vitest + Playwright smoke tests | Validate mathematical and user-facing behavior |
| Later photometry | Astropy FITS + photutils | Image data and aperture measurements |

Use a small monorepo: `/frontend` and `/backend`. Have the frontend call FastAPI for astronomy/weather calculations; avoid duplicating celestial calculations in JavaScript. Keep integrations behind simple provider interfaces to allow changes.

## 5. Verified sources and integration notes

### Seestar S30 (original, not S30 Pro)

Manufacturer-published specifications for the original **S30**: telephoto **30 mm aperture, 150 mm focal length, f/5, IMX662**, **tele field of view 2.46°**, wide-angle field of view 23.2°, and **JPEG/FITS** support. The manufacturer states an alt-azimuth mount, with equatorial mode supported. **Do not confuse original S30 with newer S30 Pro**. The published 2.46° FOV is not clearly stated as horizontal/vertical/diagonal; do not calculate a precise framing rectangle until independently validated. Use it as an approximate angular-fit reference initially.

Sources:
- https://us.seestar.com/products/seestar-s30-all-in-one-smart-telescope
- https://helpdesk.zwoastro.com/hc/en-us/articles/48476700259213-Seestar-S30-S50-S50-Pro-S30-Pro-Comparison

### Weather

Open-Meteo Forecast API: `https://api.open-meteo.com/v1/forecast` with `latitude`, `longitude`, `hourly`, `timezone` (e.g., `auto`) and optionally `forecast_days`. Useful hourly variables: `cloud_cover`, `cloud_cover_low`, `cloud_cover_mid`, `cloud_cover_high`, `precipitation_probability`, `precipitation`, `relative_humidity_2m`, `wind_speed_10m`, `visibility`. Verify requested variable availability and handle nulls. Weather forecasts are estimates, not on-site measurements. Show forecast model/source timestamp when available.

**Licensing:** the free API is for noncommercial/prototyping use. Attribute Open-Meteo and consult pricing/commercial rights before monetization or using it in a commercial app.

Sources:
- https://open-meteo.com/en/docs
- https://open-meteo.com/en/pricing
- https://github.com/open-meteo/open-meteo/blob/main/openapi/forecast.yml

### Celestial positions and night

Use Astropy `SkyCoord`/`EarthLocation`/`Time`/`AltAz`, `get_sun`, and `get_body('moon',...)` (optionally astroplan for scheduling helpers). Define observers using actual lat/lon and timestamps. **Calculate in UTC and present in the location's IANA timezone**, properly handling dates crossing midnight and daylight-saving transitions.

Definitions:
- Astronomical night: Sun center altitude below **−18°** (state it explicitly).
- User-configurable minimum target altitude default **30°** (heuristic, not a physical boundary).
- Best target window: a **contiguous interval** satisfying darkness and minimum altitude, preferably favorable weather; calculate samples frequently enough (e.g., 5–10 minutes, with boundary interpolation where useful).
- Moon interference: consider Moon altitude, phase illumination, angular separation to target, and broadband vs emission-nebula observing; moon phase alone is inadequate.
- Where no astronomical night occurs at high latitude, explain why and optionally offer alternative darkness settings.
- A target is not “visible tonight” if it only clears the horizon during daylight or is below the user's threshold for the full observing window.

Sources:
- https://learn.astropy.org/tutorials/2_Coordinates-Transforms.html
- https://docs.astropy.org/en/stable/api/astropy.coordinates.AltAz.html
- https://docs.astropy.org/en/stable/api/astropy.coordinates.get_body.html

### Deep-sky target catalog

Use a small reviewed seed CSV/JSON and later OpenNGC, with provenance per target and catalog identifiers. OpenNGC contains NGC/IC identifiers, J2000 RA/Dec, Messier cross-references, major/minor angular sizes where available, and is licensed **CC BY-SA 4.0**; evaluate attribution/share-alike requirements before redistributing derivative data. Avoid misusing integrated magnitude as a universal imaging difficulty score; diffuse surface brightness and optics matter.

Sources:
- https://github.com/mattiaverga/OpenNGC
- https://github.com/mattiaverga/OpenNGC/blob/master/NGC_guide.txt

### Variable stars and real science

AAVSO **VSX** catalogs variable-star identities and metadata. AAVSO has data-search/download facilities for historical observations, subject to data-usage guidelines. Do not assume there is an unrestricted public real-time JSON API, and do not scrape protected interfaces.

Scientific analysis should follow AAVSO guidance: use comparison stars, check saturation, calibrate appropriately, track uncertainty, and be mindful of the S30's color sensor and filter system. Start with *educational/research planning* before promising publishable photometry.

Sources:
- https://vsx.aavso.org/vsx/
- https://aavso.org/search-and-download-data/
- https://aavso.org/stellar-photometry/
- https://docs.astropy.org/projects/photutils/en/latest/user_guide/aperture.html

## 6. Core data model

Use UUID/string IDs, UTC ISO 8601 timestamps, IANA timezone IDs, and validated decimal-degree coordinates.

- `observing_locations`: `id`, `label`, `latitude_deg`, `longitude_deg`, `elevation_m?`, `timezone`, `created_at`.
- `equipment_profiles`: `id`, `name`, `manufacturer?`, `aperture_mm?`, `focal_length_mm?`, `fov_deg?`, `fov_definition` (`unknown|diagonal|horizontal|vertical`), `sensor?`, `mount_type?`, `source_url?`, `is_verified`, `created_at`.
- `targets`: `id`, `primary_designation`, `aliases[]`, `kind`, `ra_deg`, `dec_deg`, `coordinate_frame`, `epoch`, `magnitude?`, `angular_major_arcmin?`, `angular_minor_arcmin?`, `source_url`, `notes?`.
- `sessions`: `id`, `title`, `location_id`, `equipment_id`, `local_night_date`, `start_utc?`, `end_utc?`, `status` (`planned|completed|cancelled`), `notes?`.
- `session_targets`: `id`, `session_id`, `target_id`, `planned_start_utc?`, `planned_end_utc?`, `sort_order`, `actual_integration_seconds?`, `notes?`.
- `mission_templates` (later): `id`, `type` (`photography|science|challenge`), `description`, `requirements_json`, `source_url?`.
- `missions` (later): `id`, `template_id`, `target_id`, `session_id?`, `status`, `progress_json`.
- `observations` (later): `id`, `session_target_id`, `capture_start_utc`, `capture_end_utc?`, `image_path?`, `raw_file_type?`, `exposure_seconds?`, `quality_notes?`.
- `photometry_measurements` (future): `id`, `observation_id`, `target_identifier`, `time_jd`, `instrumental_mag?`, `differential_mag?`, `uncertainty?`, `comparison_identifiers`, `method_version`, `quality_flags`.

For Phase 1 keep database tables constrained to actual features; avoid implementing unused future tables unless convenient. Data migrations must be repeatable.

## 7. API contract (proposed, refine when coding)

- `GET /api/health` → service status.
- `GET /api/forecast?lat=&lon=&date=` → hourly weather, source, retrievedAt, missing-field markers (cache results).
- `GET /api/night?lat=&lon=&date=&timezone=` → twilight boundaries, Sun/Moon series, missing astronomical darkness flag.
- `GET /api/targets?type=&query=` → catalog target summaries.
- `GET /api/targets/{id}/visibility?lat=&lon=&date=&timezone=&min_altitude_deg=` → time series, rising/setting facts, valid windows.
- `GET /api/recommendations?lat=&lon=&date=&timezone=&equipment_id=` → ranked targets, per-target reasons, weather limitations, score breakdown.
- `GET/POST /api/locations`, `GET/POST /api/equipment`, `GET/POST/PATCH /api/sessions`, `POST/DELETE /api/sessions/{id}/targets`.

Example concept for a recommendation (shape illustrative, **not fabricated live data**):

```json
{
  "targetId": "m42",
  "recommendationScore": 84,
  "scoreKind": "heuristic",
  "canObserve": true,
  "windowStartUtc": "<calculated UTC ISO timestamp>",
  "windowEndUtc": "<calculated UTC ISO timestamp>",
  "why": ["Target clears minimum altitude during astronomical night"],
  "cautions": ["Cloud-cover forecast is uncertain"],
  "computedAtUtc": "<UTC ISO timestamp>"
}
```

## 8. Score logic — transparent and testable

Start with explicitly documented **heuristics**, not arbitrary fake astronomy precision.

**Tonight's Score**: an hourly forecast-weighted planning index 0–100 over actual nighttime hours. A possible initial weighting:

- Cloud cover: **45 points** (`45 × [1 − cloudCover/100]`).
- Chance of precipitation: **25 points** (`25 × [1 − precipitationProbability/100]`).
- Moonlight favorability: **20 points** (derived from illuminated fraction and whether the Moon is above the horizon; show assumptions).
- Dark observing-time availability: **10 points** (based on minutes of astronomical darkness within the selected night).

For each time sample, compute weather/moon components, then summarize with a clearly documented method (e.g., score of the **best contiguous 2-hour astronomical-night window**, not an arbitrary average). If weather is unavailable, **don't produce a weather-backed total**; show calculation-only indicators with a warning. Avoid treating 0% forecast rain probability as guaranteed dry skies. Meteorological visibility is not the same as seeing or astronomical transparency.

**Target Recommendation Score** (separate 0–100 scale): target maximum/median altitude, available contiguous imaging time, Moon separation/interference, cloud/precipitation during target window, basic equipment fit, and user preferences. Show 2–4 reasons and caution flags. Recommended targets must actually satisfy minimum observability conditions. Allow score weights to change later; write unit tests for each component and normalization.

**Accuracy requirement:** Any score should show its component factors. Explain 'why this target' and distinguish measured, forecast, calculated, and heuristic data.

## 9. UI/UX direction

**Design:** sophisticated dark observatory dashboard — deep midnight navy background, neutral graphite panels, restrained electric cyan/ice-blue highlights, occasional warm gold for selected items, subtle gradients and crisp typography. Avoid neon overload, excessive glass blur, game-like clutter, and fake NASA branding. Legible high-contrast text and keyboard accessibility are requirements.

**Global navigation:** collapsible left sidebar on desktop, compact bottom navigation or drawer on mobile. Tabs: Tonight, Explore, Research Lab, AstroLog, Settings. Persistent location and equipment selector in header.

**Tonight screen:**

```text
┌ AstroPlanner ─ Location ▼ ─ Equipment ▼ ─ Night/date ▼ ┐
│ Tonight's Score  [  0–100  ]  forecast age / confidence │
│ [Clouds] [Rain risk] [Moon] [Astronomical darkness]      │
│ ┌──── Tonight's Timeline: dusk → dawn ────────────────┐ │
│ │ weather rows + twilight + Moon + possible windows   │ │
│ └──────────────────────────────────────────────────────┘ │
│ Best Targets Tonight                         Filters ▼  │
│ [target card] [target card] [target card]               │
│ Session Plan [targets in order] [Save session]          │
└──────────────────────────────────────────────────────────┘
```

**Explore:** search / category filters / target cards / detail side panel with graph and Add to Session.

**Research Lab (Phase 1 preview):** clear “coming in Phase 1.2” roadmap, explain variable stars and photometry, links to AAVSO; no deceptive fully working controls. Later use real light-curve plots and missions.

**AstroLog (Phase 1 preview):** show saved plans and a clearly marked upcoming image/logging capability. Do not show fictional observation logs.

**Empty states:** no location, daytime only, no weather, no dark sky, no eligible targets, no saved sessions.

**Interaction:** charts show local time with timezone; tooltips show exact altitude and forecast values; date picker must be explicit about which evening the night is attributed to.

## 10. Astronomy and edge-case correctness

- The selected **night date** means local evening on that date through the next local morning, even if UTC day differs.
- Respect DST transitions (including nonexistent/ambiguous local clock hours) and use timezone-aware conversions.
- Target and Moon coordinates need topocentric transforms for the observer; moon phase and Moon-target separation must be actual computed quantities.
- Handle circumpolar objects, targets that never rise, targets that rise only in daylight, polar-day/no astronomical night, and targets spanning midnight.
- Avoid unsupported claims about imaging suitability purely from integrated visual magnitude; angular dimensions, surface brightness, optical limitations, filter behavior, and sky background matter.
- Weather data outside forecast horizon or missing data must not silently fall back to 'clear'.
- Equipment may be changed without mutating the verified S30 preset; custom profiles should be distinct.
- If the browser blocks geolocation or API retrieval, provide manual location entry and a clean error state.
- Show attribution and dates for external data; never embed an unlicensed astronomical image collection.

## 11. Build acceptance criteria / tests

1. User can run frontend/backend locally from documented commands; startup has clear checks and no missing environment variables for the initial noncommercial prototype.
2. Entering an observer location and selected local night retrieves weather or an explicit unavailable state; the date persists through reload.
3. At least 20 sourced targets appear and search/filter works.
4. Calculated target altitude changes realistically during the night; at least two reference cases are checked against an independently trusted astronomy reference (document method).
5. Targets never recommended solely because they're above the horizon **during daytime**; default 30° threshold is enforced.
6. Sun twilight, Moon altitude, and local times are based on computation and shown in correct timezone.
7. Total 0–100 and component scores sum correctly, remain bounded, and never fake data when providers fail.
8. A target can be added to, removed from, reordered in, and retained in a saved session.
9. Responsive layout works at mobile and desktop widths, with accessible controls and empty/error states.
10. No fake user observations, photometry charts, weather reports, meteor showers, or dynamic dates in product UI.
11. Unit tests cover seasonal night boundaries, DST, no astronomical darkness, never-visible target, no forecasts, and normalization.
12. README, architecture notes, and a next-milestone checklist are delivered before proceeding to Phase 1.1.

## 12. Development discipline

- Build sequentially; do **not** scaffold a sprawling nonfunctional prototype with all future modules.
- Each phase must have functioning data flow, acceptance tests, and no dead-end buttons.
- Prefer straightforward local code to elaborate cloud architecture.
- Ask only for essential runtime information if the environment is unknown; otherwise make stated assumptions and proceed.
- Maintain `PROGRESS.md` with completed, in-progress, and pending tasks.
- After each milestone: summarize changes, run commands, test results, and remaining limitations.
- Never say a source, integration, or feature is confirmed without actually testing it.
- Important: verify library versions and current API changes at implementation time; URLs and external terms may evolve.
