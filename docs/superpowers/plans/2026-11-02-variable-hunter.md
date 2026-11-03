# Variable Hunter (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Variable Hunter section with four curated variable stars, each with a star page (visibility, plans, the developer's AstroLog nights, missions) and, when the AAVSO data layer is switched on, a real AAVSO light curve and "Sky alerts" on Tonight.

**Architecture:** A curated `variables.json` (VSX provenance) behind `app/variables/`, resolved together with the DSO catalog through one `app/targets.py` lookup so plans and AstroLog treat `var:<slug>` ids like catalog ids. The visibility engine gains an explicit-coordinates seam. AAVSO access is one injected provider (`app.state.aavso`), **off by default**; with it off the app runs the design's fallback (VSX facts + link to the VSX star page, no observations, no alerts).

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic, Astropy, httpx (backend); React 19, TanStack Query, Recharts 3 (lazy), Vitest, Playwright (frontend).

**Spec:** `docs/superpowers/specs/2026-11-02-variable-hunter-design.md`

## Global Constraints

- CLAUDE.md non-negotiables and ROADMAP standing rules: no fabricated data, source + update time on real data, explicit missing/stale states, no dead buttons, no claimed tests that were not run.
- Phase 1 + Phase 2 suites stay green, unchanged (198 backend passed / 7 skipped, 69 unit, 12 e2e at branch start). Never edit an existing test's assertions to make it pass.
- Phase 1 DSO recommendations, scores and `/api/targets` results must not change: variable stars never enter `catalog.all_targets()` or `catalog.coordinate_arrays()`.
- **Privacy:** never store, return or log AAVSO `obsName`, `obsCountry`, `by` (observer code; only a salted hash is stored), `comment`, `charts`. Phase 2 rule stands: header coordinates never stored or returned.
- **Tests never touch the network.** Committed AAVSO fixtures are synthetic, shaped exactly like the real CSV header (spec §2), with sentinel names `ZZ_SENTINEL_NAME` / `ZZ_SENTINEL_COUNTRY` / observer code `ZZSEN` planted.
- AAVSO switch: `ASTROPLANNER_AAVSO_ENABLED=1` → real `VsxProvider`; `ASTROPLANNER_AAVSO_FIXTURE_DIR=<dir>` → `FixtureProvider` reading synthetic CSV files (used by e2e; implies enabled); neither → `app.state.aavso = None` (fallback mode). Default is fallback.
- Requests to AAVSO: only `https://vsx.aavso.org/index.php`; sequential, ≥ 2 s apart process-wide; user agent `AstroPlanner/0.3 (+https://github.com/JoeyPhatsJr/astroplanner; personal non-commercial)`; never `www.aavso.org`, never attempt to pass a Cloudflare challenge.
- Attribution shown wherever AAVSO data or VSX facts appear (exact text): "Catalog data: International Variable Star Index (VSX), operated at AAVSO, Cambridge, Massachusetts, USA." and, with observations, "Observations from the AAVSO International Database, contributed by observers worldwide. © AAVSO."
- Migrations hand-written, SQLite + Postgres (`DATABASE_URL` seam); next revision is `0005_variable_hunter`; `test_migrations.py` ORM-vs-migrated comparison must keep passing.
- Brighter is up on every light curve (inverted magnitude axis), labelled "Brighter ↑".
- No predictions: no eruption dates, countdowns, eclipse timetables, or "expected" text anywhere.
- S30 limits are an **estimate**: `S30_ESTIMATED_RANGE = (7.0, 12.5)` with label "estimate, not yet measured".
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Overlapping fetch windows (alert path and history path both cover the last 3 days) → observations are de-duplicated by AAVSO `obsID`, never double-plotted or double-counted toward alerts. Test in Task 6.
2. AAVSO rows with a blank or non-numeric `mag`, `fainterThan=1`, or a band outside V/Vis. → excluded from curve and alerts, and the curve's "included" line says which bands are shown. Test in Task 6.
3. AAVSO fails part-way through a history fill (chunk 3 of 12 raises) → cached chunks remain, the page shows them plus "AAVSO unreachable, last successful check …", and the next attempt resumes at the first missing chunk. Test in Task 6.
4. Weekly-watch streak across a week boundary in the observer's timezone, and a night the developer shot after local midnight → night is the session's `local_night_date` (noon-to-noon rule), not the UTC date. Test in Task 4.
5. Adding a variable star twice to a plan → 409; a plan containing `var:` ids renders names in the session list, Tonight plan panel and AstroLog "not shot" without 500s. Test in Task 3.

---

### Task 1: Curated variable-star catalog and unified target lookup

**Files:**
- Create: `backend/scripts/build_variables.py`, `backend/app/data/variables.json`, `backend/app/variables/__init__.py`, `backend/app/variables/catalog.py`, `backend/app/targets.py`
- Modify: `backend/app/data/ATTRIBUTION.md` (VSX section)
- Test: `backend/tests/test_variables_catalog.py`

**Interfaces:**
- Produces: `variables.catalog.all_stars() -> list[dict]`, `get_star(star_id: str) -> dict | None` (accepts `"var:ss-cyg"`), `star_by_slug(slug: str) -> dict | None`, `alias_index() -> dict[str, str]` (normalized alias → star id, using `app.astrolog.headers.normalize_object`), `target_view(star) -> dict` with keys `id, primary_designation, name, category="variable", kind="variable", constellation, ra_deg, dec_deg`.
- Produces: `targets.lookup(target_id: str) -> dict | None` (DSO catalog dict, else `target_view` of the star, else None) and `targets.is_variable(target_id: str) -> bool`.

Star record shape (one per star, ids `var:ss-cyg`, `var:u-gem`, `var:r-leo`, `var:t-crb`):

```json
{"id": "var:ss-cyg", "slug": "ss-cyg", "name": "SS Cygni", "primary_designation": "SS Cyg",
 "aliases": ["SS Cyg", "SS Cygni"], "constellation": "Cyg", "ra_deg": 0.0, "dec_deg": 0.0,
 "type_label": "Dwarf nova (U Gem type)",
 "vsx": {"name": "SS Cyg", "auid": "...", "oid": 0, "variability_type": "UGSS", "period_days": null,
         "max_mag": 7.7, "min_mag": 12.4, "band": "V", "epoch_jd": null},
 "alert": {"brighter_than": 10.0, "min_observers": 2, "normal_text": "quiet near 12 V",
           "why": "Outbursts reach about 8.5 V; 10.0 is well clear of quiescent scatter."},
 "missions": ["outburst", "weekly"],
 "history_windows": [],
 "source": "AAVSO VSX", "source_url": "https://vsx.aavso.org/index.php?view=detail.top&oid=<OID>",
 "retrieved": "YYYY-MM-DD"}
```

Curated values (spec §7.1, verbatim): alert thresholds SS Cyg 10.0 (2 observers), U Gem 11.0 (2), T CrB 8.0 (**3** observers), R Leo `"alert": null`. Missions: SS Cyg/U Gem `["outburst","weekly"]`, R Leo `["cycle","weekly"]`, T CrB `["weekly"]`. T CrB `history_windows`: `[{"key": "1946", "label": "1946 eruption", "from_date": "1946-01-01", "to_date": "1946-06-30", "source": "Eruption discovered 1946 February 9; ADS 1946PASP...58..196H"}]`. `type_label` values: SS Cyg/U Gem "Dwarf nova (U Gem type)", R Leo "Mira variable", T CrB "Recurrent nova". Aliases add the full Latin form ("U Geminorum", "R Leonis", "T Coronae Borealis", "Blaze Star"). VSX `period_days` is stored as VSX gives it, but `"period_note"` explains for SS Cyg/U Gem/T CrB that it is the orbital period, not an outburst interval.

- [ ] **Step 1: Write the build script** `build_variables.py`: for each curated star, GET `api.object&ident=<primary_designation>&format=json` (rules in Global Constraints), parse `RA2000`/`Declination2000` floats, `MaxMag`/`MinMag` strings like `"7.7 V"` → float + band (a leading `(` or trailing `:` is stripped; record raw string in `vsx.raw_range`), `Period`/`Epoch` floats or null, `OID` int; merge with the curated block above (kept as a dict in the script) and write `variables.json` sorted by id, plus `"meta": {"source": "AAVSO VSX api.object", "retrieved": <today>, "license_note": <VSX copyright sentence from spec §2>}`.
- [ ] **Step 2: Run it once** (network): `cd backend && .venv/bin/python scripts/build_variables.py` → writes 4 stars. Check T CrB: `MaxMag 2.0 V`, `MinMag 10.8 V`, OID 10602, `NR+ELL`.
- [ ] **Step 3: Write failing tests** in `test_variables_catalog.py`:
  - `test_four_curated_stars_with_provenance`: ids == {var:ss-cyg, var:u-gem, var:r-leo, var:t-crb}; each has `source_url` starting `https://vsx.aavso.org/index.php?view=detail.top&oid=` and `retrieved`.
  - `test_alert_rules_match_spec`: SS Cyg (10.0, 2), U Gem (11.0, 2), T CrB (8.0, 3), R Leo None.
  - `test_lookup_resolves_both_kinds`: `lookup("m27")` is the catalog dict (any existing catalog id); `lookup("var:t-crb")["kind"] == "variable"`; `lookup("var:nope") is None`.
  - `test_dso_catalog_unchanged`: `len(catalog.all_targets()) == 58` and no id starts with `var:`.
  - `test_alias_index`: `alias_index()[normalize_object("SS Cygni")] == "var:ss-cyg"`; T CrB reachable from "Blaze Star".
  - `test_t_crb_coordinates_match_vsx`: ra ≈ 239.87567, dec ≈ 25.92017 (abs 1e-4).
- [ ] **Step 4: Implement** `variables/catalog.py` (lru-cached load like `catalog.py`) and `targets.py`. Run `pytest tests/test_variables_catalog.py -v` → PASS; full suite green.
- [ ] **Step 5: Commit** `feat(variables): curated VSX-sourced variable-star catalog and unified target lookup`.

### Task 2: Visibility seam for explicit coordinates

**Files:**
- Modify: `backend/app/astronomy.py` (`sky_context`), `backend/app/api.py` (add route)
- Create: `backend/app/variables/routes.py` (router `prefix="/api/variables"`, included in `main.create_app`)
- Test: `backend/tests/test_variables_visibility.py`

**Interfaces:**
- Consumes: Task 1 `star_by_slug`.
- Produces: `sky_context(latitude, longitude, elevation_m, night_date, tz_name, coords: tuple[tuple[float, ...], tuple[float, ...]] | None = None) -> SkyContext` (None = DSO catalog, exactly as today; tuples keep it `lru_cache`-hashable). `GET /api/variables/{slug}/visibility` with the same observer query params, `min_altitude_deg` and `darkness` as `/api/targets/{id}/visibility`, returning `{computed_at_utc, star: target_view, visibility: visibility_payload(..., include_series=True) + sun/moon series, night: {same keys as the target route}}` and **no score** (scores are DSO heuristics).

- [ ] **Step 1: Failing tests**:
  - `test_variable_altitude_matches_independent_astropy`: for T CrB at the sample location (39.9526, −75.1652, tz America/New_York) on night 2027-03-15, every series altitude equals an independent `SkyCoord(...).transform_to(AltAz(..., pressure=0))` at the same timestamps within 0.1°.
  - `test_unknown_slug_404`.
  - `test_catalog_sky_context_unchanged`: `sky_context(...)` with `coords=None` gives `target_alt.shape[0] == 58` and identical arrays to a call made before the change (compare against the existing reference tests: they must pass untouched).
  - `test_low_in_november`: T CrB on 2026-11-15 at the sample location has no window above 30° in astronomical darkness (recon §2) and status text says so.
- [ ] **Step 2: Implement**; index 0 of a one-star context is the star. Run new tests + `tests/test_reference_astronomy.py tests/test_night_and_visibility.py` → PASS.
- [ ] **Step 3: Commit** `feat(variables): explicit-coordinate sky context and star visibility endpoint`.

### Task 3: Plans and AstroLog accept variable stars

**Files:**
- Modify: `backend/app/api.py` (session add/out use `targets.lookup`), `backend/app/astrolog/library.py` (`display_name`, `_category`, extract `_move_records(db, src, dest)` from `merge_into_unsorted`, add `link_to_variable`), `backend/app/astrolog/importer.py` (`resolve_target`), `backend/app/astrolog/models.py` (`TargetKind` adds `"variable"`), `backend/app/astrolog/routes.py` (403 for `variable` in PATCH; new POST)
- Test: `backend/tests/test_variables_plans_astrolog.py`

**Interfaces:**
- Consumes: Task 1 `targets.lookup`, `alias_index`, `get_star`.
- Produces: `resolve_target(name)` returns `TargetRef(f"variable:{slug}", "var:<slug>", star["primary_designation"], "variable")` for curated aliases (checked **after** the DSO catalog index). `POST /api/astrolog/targets/{library_target_id}/link-variable` body `{"star_id": "var:ss-cyg"}` → 200 target page; 403 unless the target is `custom`; 422 unknown star; if a `variable` target for that star exists, records are moved into it (same as the Unsorted merge) and the source row is deleted; otherwise the row becomes `kind="variable"`, `catalog_target_id=star_id`, `normalized_key=f"variable:{slug}"`, `custom_name=None`.

- [ ] **Step 1: Failing tests** (use the Phase 2 fixtures in `tests/astrolog_fixtures.py` to build FITS headers with `OBJECT="SS Cyg"`):
  - `test_add_variable_to_plan_and_reload`: POST `var:ss-cyg` → 201; GET session shows target name "SS Cygni"; second POST → 409 (Review Focus 5).
  - `test_session_list_and_not_shot_with_variable`: GET `/api/sessions` and the AstroLog night page for a plan with `var:t-crb` and no frames → 200, "not shot" lists "T Coronae Borealis"/designation, no 500.
  - `test_import_ss_cyg_creates_variable_target_and_attaches_plan`: plan for night N with `var:ss-cyg`; import frames named "SS Cyg" on N → library target `kind == "variable"`, `catalog_target_id == "var:ss-cyg"`, session target `library_target_id` set (acceptance 7).
  - `test_link_custom_target_converts`: pre-existing custom target "SS Cygni" (created by importing before the alias existed, i.e. insert directly) → POST link-variable → kind variable; capture sets unchanged in count.
  - `test_link_merges_into_existing_variable_target`: both a variable SS Cyg target and a custom one exist → after link, one target remains with the sum of capture sets; source row gone.
  - `test_link_rejects_catalog_and_unsorted`: 403 for catalog and for Unsorted; PATCH on a variable target → 403.
  - `test_dso_import_unchanged`: an `OBJECT="NGC 7635"` import still resolves to the catalog target (DSO index wins).
- [ ] **Step 2: Implement**; run new tests + `tests/test_astrolog_*.py tests/test_api.py` → PASS.
- [ ] **Step 3: Commit** `feat(variables): variable stars in plans, AstroLog import and explicit linking`.

### Task 4: Star API in fallback mode, missions, Seestar fit

**Files:**
- Create: `backend/app/variables/missions.py`, `backend/app/variables/fit.py`
- Modify: `backend/app/variables/routes.py`, `backend/app/main.py` (`create_app(..., aavso=None)`; env selection per Global Constraints; `app.state.aavso`)
- Test: `backend/tests/test_variables_missions.py`, `backend/tests/test_variables_api.py`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `missions.star_nights(db, star_id) -> list[date]` (distinct `ObservingSession.local_night_date` of capture sets whose library target has `catalog_target_id == star_id`, ascending).
  - `missions.weekly_streak(nights: list[date], today: date) -> int`: consecutive ISO weeks with ≥ 1 night ending at the current ISO week, or at the previous week if the current week has none yet.
  - `missions.monthly_count(nights, today, months=6) -> int`: distinct calendar months with a night among the last `months` months including the current one.
  - `missions.outburst_nights(nights, windows: list[tuple[date, date]]) -> int` (max nights inside any one window).
  - `fit.seestar_fit(star) -> dict | None`: `{"estimate_range": [7.0, 12.5], "label": "estimate, not yet measured", "text": ...}`; text says when the VSX max is brighter than 7.0 ("near maximum it is probably too bright for the S30") and/or min fainter than 12.5 ("near minimum it is probably too faint"); returned only when the selected equipment is the S30 preset (`equipment_id` query param resolving to the seeded preset), else None.
  - `GET /api/variables` → `{"aavso": {"enabled": bool, "mode": "off"|"live"|"fixture"}, "stars": [{star target_view + type_label, vsx range, nights_count, alert: null}]}`.
  - `GET /api/variables/{slug}?equipment_id=` → `{star, vsx, type_label, period_note, source_url, retrieved, attribution: [..exact strings..], nights: [ISO dates], missions: [{key, title, description, progress, goal, unit, available: bool, reason?}], seestar_fit, aavso: {enabled, mode, fallback_link: source_url}}`. Mission titles/descriptions: "Catch an outburst" / "Shoot it on 3 nights during one outburst." (goal 3, unit "nights"); "Weekly watch" / "At least one night every week." (progress = streak, unit "week streak"); "Follow the cycle" / "One night a month for 6 months." (goal 6, unit "months"). With AAVSO off, "outburst" has `available: false, reason: "Needs AAVSO data (off)"` and is **omitted** from the UI by Task 5.
- [ ] **Step 1: Failing tests** `test_variables_missions.py`: `weekly_streak` for nights in ISO weeks 44, 45, 46 with today in week 46 → 3; today in week 47 with no night yet → 3; gap at week 45 → 1; a night on `local_night_date` Sunday 2026-11-08 shot at 00:30 Monday local counts for week 45 (Review Focus 4). `monthly_count` 6 different months → 6, two nights same month → 1. `outburst_nights` with windows [(Oct 1, Oct 10)] and nights Oct 2, Oct 5, Oct 20 → 2.
- [ ] **Step 2: Failing tests** `test_variables_api.py`: list has 4 stars and `aavso.enabled is False` by default; star page R Leo with S30 preset `seestar_fit.text` mentions "too bright" and label "estimate, not yet measured"; with a custom equipment id `seestar_fit is None`; `attribution` contains the VSX sentence exactly; missions omit nothing but mark outburst unavailable when off; response JSON never contains `ZZ_SENTINEL` (trivially true now, kept as a guard for Task 7); nights reflect an imported SS Cyg set.
- [ ] **Step 3: Implement**; run new tests and full suite → PASS.
- [ ] **Step 4: Commit** `feat(variables): star API, missions from AstroLog nights, Seestar fit estimate, AAVSO switch`.

### Task 5: Frontend Variable Hunter (fallback mode)

**Files:**
- Create: `frontend/src/api/variables.ts`, `frontend/src/pages/VariableHunterPage.tsx`, `frontend/src/pages/StarPage.tsx`, `frontend/src/components/variables/MissionCard.tsx`, `frontend/src/components/variables/StarExplainer.tsx`, `frontend/src/components/variables/variables.test.tsx`
- Modify: `frontend/src/App.tsx` (routes `/variables`, `/variables/:slug`; `/research` → `<Navigate to="/variables" replace>`), `frontend/src/components/layout/AppShell.tsx` (nav label "Variable Hunter", mobile label "Variables", icon `Sparkles` from lucide-react), `frontend/src/pages/TargetLogPage.tsx` ("This is …" action for custom targets), `frontend/src/api/astrolog.ts` (`useLinkVariable`). Delete `frontend/src/pages/ResearchLabPage.tsx` and update e2e/smoke references to "Research Lab" only if a test asserts the nav label (update the expected label, nothing else).
- Test: `variables.test.tsx`

**Interfaces:**
- Consumes: Task 2 visibility route, Task 4 list/star routes, Task 3 link route, existing `useObserver`, `useCurrentEquipment`, `useSessionMutations`, `formatIntegration`, `ConfirmDialog`, `States` components.
- Produces hooks: `useVariables()`, `useStar(slug)`, `useStarVisibility(slug)`, `useLinkVariable(libraryTargetId)`; types `VariablesResponse`, `StarResponse`, `Mission` in `api/variables.ts`.

Page content (approved mockup, spec §3.2 / §7.6): list page = one card per star (name, type_label, VSX range, "Tonight: above 30° from … to …" or the visibility status text, "Your nights: N"). Star page = header (name, type, "range 7.7–12.4 V (VSX)"), facts row (tonight window from `useStarVisibility`, your nights), **fallback panel when `aavso.enabled` is false**: "Light curve: not shown. AAVSO data is switched off in this app until its terms are confirmed." + link "View SS Cyg on AAVSO VSX →" (`source_url`, `target="_blank" rel="noopener"`), mission cards (only `available` ones), Seestar fit note (if present), "Add to tonight's plan" button (same behaviour as Explore's Add to Session, incl. disabled state with reason when no session/location), explainer (what a light curve is, brighter is up, comparison stars, saturation, uncertainty; links to `https://www.aavso.org/variable-star-observing-manual`-style pages are **not** allowed unless verified — use the VSX star page and `https://vsx.aavso.org/index.php?view=about.vartypes` only), "Coming in Phase 4" card, attribution lines. Loading/error/empty states via `States`. No location → visibility block says "Set a location in Settings to see tonight's window" with a link.

- [ ] **Step 1: Failing Vitest tests** with mocked fetch: list renders 4 stars; star page in fallback mode shows the VSX link with the star's `source_url` and **no** chart element; mission "Catch an outburst" absent when unavailable; Seestar note renders its estimate label; "This is SS Cyg" button only on custom targets and calls the link endpoint; `/research` redirects to `/variables`.
- [ ] **Step 2: Implement**; `npm run typecheck && npm test` → PASS.
- [ ] **Step 3: Commit** `feat(variables): Variable Hunter pages, missions, fallback AAVSO link, AstroLog linking UI`.

### Task 6: AAVSO provider, cache, migration (switched off by default)

**Files:**
- Create: `backend/app/variables/aavso.py`, `backend/app/variables/cache.py`, `backend/app/variables/models.py`, `backend/migrations/versions/0005_variable_hunter.py`, `backend/tests/aavso_fixtures.py`
- Modify: `backend/app/db.py` (import models so metadata includes them), `backend/tests/test_migrations.py` only to add the new tables to any explicit table list it keeps
- Test: `backend/tests/test_variables_aavso.py`

**Interfaces:**
- Produces:
  - `Observation` dataclass: `obs_id: str, jd: float, mag: float, uncert: float | None, band: str, fainter_than: bool, obs_type: str, val: str, observer_hash: str`.
  - `class AavsoProvider(Protocol)`: `fetch_observations(ident: str, from_jd: float, to_jd: float) -> list[Observation]`.
  - `VsxProvider(fetch: Callable[[dict], httpx.Response] | None = None, sleep=time.sleep, clock=time.monotonic, salt: str)`: builds the `api.delim` request (`view=api.delim, ident, fromjd, tojd, delimiter=","`), enforces the ≥ 2 s spacing with a module-level lock, parses with `csv.DictReader`, and **drops every column except** `obsID, JD, mag, uncert, band, fainterThan, obsType, val, by`; `by` becomes `observer_hash = sha256(salt + by).hexdigest()[:16]` immediately; rows with non-numeric JD/mag are skipped (Review Focus 2).
  - `FixtureProvider(dir: Path, salt)`: reads `<dir>/<slug>.csv` (same CSV format), filters by JD range.
  - Tables (migration 0005): `variable_observations(id pk, star_id str(32) idx, obs_id str(40), jd float idx, mag float, uncert float null, band str(16), fainter_than bool, obs_type str(16), val str(4), observer_hash str(16), unique(star_id, obs_id))`; `variable_fetches(id pk, star_id, path str(8) 'alert'|'history', from_jd, to_jd, started_at, finished_at null, ok bool, rows int, error str(200) null)`; `variable_alert_dismissals(id pk, star_id unique, dismissed_at, alert_since_jd float)`. Salt stored in `app_meta` key `aavso_observer_salt` (generated once with `secrets.token_hex(16)`).
  - `cache.refresh_alert_window(db, provider, star, now: datetime) -> FetchResult` (last 3 days; skipped if an ok `alert` fetch for the star finished < 6 h ago).
  - `cache.fill_history(db, provider, star, now, chunk_days=30, days=365) -> FetchResult` (missing 30-day chunks oldest → newest from the ok `history` fetch ranges; after full coverage, incremental from max cached JD, at most once per 6 h; stops at the first failing chunk and records it).
  - `cache.fill_window(db, provider, star, from_date, to_date)` for fixed history windows (T CrB 1946), fetched once.
  - `cache.status(db, star_id, now) -> {"last_ok_utc", "last_error", "coverage_days", "target_days", "loading": bool}`.
  - Insert with conflict-ignore on `(star_id, obs_id)` (portable: check existing keys first, like Phase 2 `existing_keys`).
- [ ] **Step 1: Synthetic fixtures** `aavso_fixtures.py`: `make_csv(rows: list[dict]) -> str` producing the exact real header from spec §2 and filling `obsName=ZZ_SENTINEL_NAME`, `obsCountry=ZZ_SENTINEL_COUNTRY`, `by=ZZSEN` (or per-row codes `ZZOB1`, `ZZOB2`… for distinct observers), plus helpers for a quiet curve and an outburst; `RecordingFetch` like conftest's.
- [ ] **Step 2: Failing tests**: parse keeps only the allowed fields and no sentinel string appears in any `Observation` repr or DB row (acceptance 3); blank/`<11.5`/non-numeric mag rows skipped; `fainterThan=1` kept with flag set; overlapping alert + history windows insert each `obsID` once (Review Focus 1); second `refresh_alert_window` within 6 h → no fetch call, after 6 h → one call (acceptance 4); `fill_history` with chunk 3 raising → chunks 1–2 cached, fetch row `ok=False`, status `last_error` set, next call starts at chunk 3 (Review Focus 3); requests spaced ≥ 2 s (fake clock/sleep records the waits); user agent header equals the Global Constraints string; migration upgrade/downgrade on SQLite (Postgres via existing `TEST_POSTGRES_URL` test).
- [ ] **Step 3: Implement**; run `pytest tests/test_variables_aavso.py tests/test_migrations.py -v` and full suite → PASS.
- [ ] **Step 4: Commit** `feat(variables): AAVSO VSX provider and observation cache (off by default)`.

### Task 7: Light curve and Sky alerts API

**Files:**
- Create: `backend/app/variables/curve.py`, `backend/app/variables/alerts.py`
- Modify: `backend/app/variables/routes.py`, `backend/app/variables/missions.py` (outburst windows from cache)
- Test: `backend/tests/test_variables_alerts.py`, `backend/tests/test_variables_curve.py`

**Interfaces:**
- Consumes: Task 6 cache/provider, Task 4 missions.
- Produces:
  - `GET /api/variables/{slug}/curve?window=recent|<history_window key>` (409 with message when AAVSO is off): triggers `fill_history` (or `fill_window`) via FastAPI `BackgroundTasks` and returns what is cached now: `{"points": [[jd, mag, band]] down-sampled to ≤ 3000 positive V/Vis. detections (every Nth, N reported), "daily": [[iso_date, mean_mag, n]], "counts": {"cached": int, "plotted_points": int, "every_nth": int}, "bands_included": ["V", "Vis."], "excluded_note": "Fainter-than estimates and other bands are not plotted.", "status": cache.status, "attribution": [...]} `. `window=recent` covers the last 365 days.
  - `alerts.evaluate(observations, star, now, status) -> dict`: `{"star_id", "state": "alert"|"no_change"|"stale"|"unavailable", "evidence": {"observers": int, "threshold": float, "window_hours": 48, "brightest": float|None}, "current_mag": float|None (median of last 48 h positive detections), "normal_text", "checked_utc"}`. Rules (spec §7.2): only `fainter_than=False`, bands V/Vis.; distinct `observer_hash` with `mag < brighter_than` within 48 h ≥ `min_observers` → alert; never fetched → unavailable; no ok fetch in 24 h or last fetch failed → stale (never no_change).
  - `GET /api/variables/alerts?lat&lon&...observer params` (AAVSO off → `{"enabled": false, "alerts": []}`): runs `refresh_alert_window` for stars with an alert rule (sequential), evaluates, adds tonight's window above the min altitude for each alerting star (Task 2 engine), excludes dismissed alerts whose `alert_since_jd` matches the current alert episode; returns `{"enabled": true, "alerts": [...], "dot": bool}` where `dot` is true if any non-dismissed `alert`.
  - `POST /api/variables/{slug}/alerts/dismiss` → 204 (stores the current episode start JD; a new episode, after the star returns below threshold for a day, alerts again).
  - Outburst windows for missions: consecutive days whose daily mean is brighter than `brighter_than`, from the cache; "Catch an outburst" becomes `available: true` when AAVSO is on.
- [ ] **Step 1: Failing tests** (acceptance 2, 5, 1): 1 observer bright → no_change; 2 distinct within 48 h → alert (T CrB: 2 → no_change, 3 → alert); bright but 49 h old → no_change; only `fainterThan` rows bright → no_change; last ok fetch 25 h ago → stale; never fetched → unavailable; dismiss hides it, a later episode re-alerts; curve endpoint points equal the fixture's positive V/Vis. detections when ≤ 3000, `every_nth` > 1 when more; off → 409 and alerts `enabled false`; no response contains `ZZ_SENTINEL` or `ZZSEN`; outburst mission counts 2 of 3 nights inside a synthetic outburst and ignores a night outside it.
- [ ] **Step 2: Implement**; run new tests + full suite → PASS.
- [ ] **Step 3: Commit** `feat(variables): light-curve and Sky alerts endpoints with evidence and staleness`.

### Task 8: Light curve chart, Sky alerts card, menu dot

**Files:**
- Create: `frontend/src/components/variables/LightCurve.tsx` (Recharts, lazy via `LazyCharts.tsx` export `LightCurve`), `frontend/src/components/variables/SkyAlertsCard.tsx`
- Modify: `frontend/src/api/variables.ts` (`useStarCurve(slug, window)` polling every 5 s while `status.loading`, `useVariableAlerts()` with `staleTime` 10 min, `useDismissAlert`), `frontend/src/pages/StarPage.tsx`, `frontend/src/pages/TonightPage.tsx` (card above the plan panel, only when `enabled`), `frontend/src/components/layout/AppShell.tsx` (dot on the Variable Hunter item when `dot`, with `aria-label` "Variable Hunter, new sky alert"), `frontend/src/components/variables/variables.test.tsx`

Chart: Y axis reversed (smaller magnitude on top) labelled "Magnitude (V) · Brighter ↑"; daily-average line in the accent colour; individual points as muted scatter; V and Vis. distinguishable (shape or opacity) with a legend; the developer's nights as markers along the bottom; colours from `useThemeColors()` so night vision works; tooltip shows date, magnitude, band. Below: source line "AAVSO International Database via VSX · {cached} observations cached · {plotted} shown (every {n}th) · checked {relative time}" + `excluded_note` + attribution, and a loading line "Loading history: {coverage}/{target} days" while `loading`. T CrB: second chart (or tab) "1946 eruption" from `window=1946`. Sky alerts card: rows `"{name} in outburst · ~{current_mag} V"` + tonight window or "below {min}° tonight", evidence line "{observers} observers reported it brighter than {threshold} in the last 48 h · AAVSO, checked {relative}", Dismiss button; stale/unavailable rows say so explicitly; `no_change` rows show "no change · {current_mag} V". Card hidden entirely when `enabled` is false.

- [ ] **Step 1: Failing Vitest tests**: chart receives reversed domain and renders the source line with counts; loading text while `status.loading`; alerts card renders alert evidence and Dismiss calls the endpoint; stale row text contains "stale" and never "no change"; dot rendered only when `dot` true; card absent when `enabled` false.
- [ ] **Step 2: Implement**; `npm run typecheck && npm test && npm run build` → PASS (no new chunk-size warning; Recharts stays lazy).
- [ ] **Step 3: Commit** `feat(variables): light curve chart, Sky alerts card and menu dot`.

### Task 9: End-to-end, docs, screenshots

**Files:**
- Create: `frontend/e2e/variables.spec.ts`, `frontend/e2e/aavso-fixtures/ss-cyg.csv` (+ `u-gem.csv`, `t-crb.csv`, `r-leo.csv`; synthetic, sentinel names, generated by a small script `frontend/e2e/make-aavso-fixtures.mjs` that is committed alongside), docs screenshots `docs/screenshots/variable-hunter-*.png` (synthetic fixture data only)
- Modify: `frontend/playwright.config.ts` (second backend on port 8101 with `ASTROPLANNER_AAVSO_FIXTURE_DIR=e2e/aavso-fixtures` and a separate DB, plus a Vite server on 5181 proxying to it, used only by `variables.spec.ts` "alerts" tests via a project or `test.use({ baseURL })`), `README.md`, `docs/ARCHITECTURE.md`, `PROGRESS.md`, `ROADMAP.md` (status, G1 state, decision-log rows for: AAVSO layer off by default; VSX copyright allows personal non-commercial use; public deployment needs AAVSO permission)

- [ ] **Step 1: e2e (fallback backend, ports 8100/5180)**: nav shows "Variable Hunter"; `/research` lands on `/variables`; SS Cyg page shows the VSX link and no chart; "Add to tonight's plan" adds it and it survives reload.
- [ ] **Step 2: e2e (fixture backend)**: Tonight shows the Sky alerts card with the SS Cyg outburst evidence and the menu dot; SS Cyg page shows the chart and source line; with the fixture for U Gem lacking recent rows, its row reads stale/unavailable explicitly (acceptance 8). Desktop + mobile.
- [ ] **Step 3: Run everything**: `cd backend && .venv/bin/python -m pytest -q`; `cd frontend && npm run typecheck && npm test && npm run build && npx playwright test` → all PASS; record exact counts.
- [ ] **Step 4: Docs** with the real counts, screenshots, how to switch AAVSO on (`ASTROPLANNER_AAVSO_ENABLED=1`), the G1 status and what remains before deployment.
- [ ] **Step 5: Commit** `test(e2e): Variable Hunter fallback and fixture-backed alerts; docs`.

### After the plan (controller, not a task)

Local live check (acceptance 10, personal non-commercial use per VSX copyright): start the backend with `ASTROPLANNER_AAVSO_ENABLED=1` against a scratch DB, open SS Cyg once, confirm the 365-day curve shows the outbursts seen in recon (≈ 12 → 8.5–9 V); record the result in PROGRESS.md. Do not merge; leave the branch for developer review.
