# Polish Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AstroPlanner feel finished: shared foundations, an honest redesigned Tonight, sky images, purposeful motion, a native-feeling phone experience and leak-free night vision.

**Architecture:** Frontend polish on the existing React/Tailwind app with CSS transitions and direct style writes. The backend gains one computed field (`night_clear`) and one cached image provider, injected through `app.state` like weather. All astronomy stays on the backend.

**Tech Stack:** React 19, TypeScript, Tailwind 4, FastAPI, NumPy, Pillow (already present), httpx (already present). No new dependencies unless Task 11's library decision adds one.

**Spec:** `docs/superpowers/specs/2026-11-09-polish-pass-design.md`. Visual reference: `docs/superpowers/mockups/2026-11-09-polish/tonight.html`.

**Worktree:** `.claude/worktrees/polish-pass`, branch `worktree-polish-pass`. Run everything from there. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Commands:** backend `cd backend && .venv/bin/python -m pytest -q`; frontend `cd frontend && npm run typecheck && npm test && npm run build`; e2e `cd frontend && npx playwright test`.

## Global Constraints

- Easing: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`; `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`. Never `ease-in` on UI, never `transition: all`, never `scale(0)`.
- Durations: press 120 ms, small 180 ms, overlay in 280 ms, overlay out 200 ms. Animate transform and opacity only, except disclosures.
- Page widths: `wide` 1120 px and `reading` 860 px only. Nothing under 11 px. Touch targets at least 44 px on phones.
- Hours and clocks display in the observer's IANA timezone, never the browser's. UTC internally.
- Never render absent forecast data as clear or as zero. Every 0–100 score stays labelled heuristic with its factors reachable.
- Survey images are never committed; `backend/data/sky-images/` is git-ignored. No test touches the network.
- Do not change how any score is calculated.
- Night vision: nothing but red may reach the screen.
- Keep test ids `score-total` and `score-no-total`, and the accessible names "Night vision", "Close details", `Add {name} to session`, `{name} is in your session`.

## Review Focus

1. **A DST-change night, or a browser in a different timezone from the observer:** strip hour labels and headline times use the observer's zone (Task 4 test).
2. **A timezone with a 45-minute offset:** half-hour rounding happens on the local clock, not on epoch time (Task 4 test).
3. **STScI answers 200 with an HTML error page** (observed for widths over 120′): treated as a failed fetch, never saved as an image (Task 7 test).
4. **Two cards ask for the same uncached image at once:** one upstream request (Task 7 test).
5. **A dialog closed mid-transition, reopened at once, or unmounted by navigation:** never stuck open, never leaves the page inert (Task 9 test).

---

### Task 1: Motion tokens, press states and platform baseline

**Files:** Modify `frontend/index.html`, `frontend/src/index.css`, `frontend/src/components/layout/AppShell.tsx:112-115`. Test: `frontend/src/index.css.test.ts` (new).

**Interfaces:** Produces CSS custom properties `--ease-out`, `--ease-drawer`, `--dur-press`, `--dur-small`, `--dur-in`, `--dur-out` and utility class `.press`.

- [ ] **Step 1: Write the failing test.** Read `index.css` as text in Vitest and assert: contains `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`; contains `.btn:active`; no match for `transition:\s*all`; no `.btn:hover` rule outside an `@media (hover: hover) and (pointer: fine)` block; contains `-webkit-tap-highlight-color: transparent`. Read `index.html` and assert the viewport has `viewport-fit=cover` and no `user-scalable` or `maximum-scale`.
- [ ] **Step 2: Run it** (`npx vitest run src/index.css.test.ts`). Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add the tokens to `@theme`/`:root`. `.btn, .press { transition: transform var(--dur-press) var(--ease-out), background-color 120ms ease, border-color 120ms ease, filter 120ms ease }`; `.btn:active:not(:disabled), .press:active { transform: scale(0.97) }`.
  - Move the three `.btn*:hover` rules into `@media (hover: hover) and (pointer: fine)`.
  - On `html`: tap highlight transparent, `-webkit-text-size-adjust: 100%`. On `button, a, [role=button], summary`: `touch-action: manipulation`; on `button, [role=button], summary`: `user-select: none` with the `-webkit-` prefix.
  - `@media (pointer: coarse) { input, select, textarea, .field { font-size: 16px } }`.
  - Reduced motion: replace `* { transition: none !important }` with a rule removing `transform` from `.btn:active, .press:active` and leaving opacity transitions alone.
  - Bottom nav: `padding-bottom: env(safe-area-inset-bottom, 0px)`, translucent `color-mix(in srgb, var(--color-night-deep) 72%, transparent)` with `backdrop-filter: blur(18px) saturate(160%)`, solid under `prefers-reduced-transparency: reduce`.
- [ ] **Step 4: Run full frontend checks.** Expected: all pass.
- [ ] **Step 5: Commit** `feat(polish): motion tokens, press states and mobile platform baseline`.

### Task 2: PageHeader, page widths, type scale, distinct badges

**Files:** Create `frontend/src/components/ui/PageHeader.tsx`. Modify every file in `frontend/src/pages/`, `frontend/src/components/ui/States.tsx:56-61`, `frontend/src/index.css`. Test: `frontend/src/components/components.test.tsx`.

**Interfaces:** Produces `PageHeader({ title, subtitle?, back?: { to: string; label: string }, actions? })`, and classes `.page-wide` (max-width 1120 px) and `.page-reading` (860 px).

- [ ] **Step 1: Write failing tests:** `PageHeader` renders one `h1` with the title, and a back link with an arrow icon and the label; `BasisBadge` renders a different class string for `forecast` and `heuristic`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Replace every page's `h1` block and `max-w-[…]`. `wide`: Tonight, Explore, Library, TargetLog, ProcessingCoach, Star, VariableHunter. `reading`: Settings, Import, Nights. Named sizes in the theme replace `text-[…]`: `text-micro` 11 px (replaces `0.68rem`, `10.5px`), `text-label` 12.5 px, `text-display` 2.4 rem with tracking −0.025em and line-height 1.08. Heuristic badge: dashed border in `--color-ink-2`; Forecast keeps the accent.
- [ ] **Step 4: Run frontend checks and e2e.** Expected: all pass.
- [ ] **Step 5: Commit** `feat(polish): shared page header, two page widths, type scale, distinct badges`.

### Task 3: `night_clear` in `/api/tonight`

**Files:** Modify `backend/app/scoring.py`, `backend/app/api.py:187-192`, `frontend/src/api/types.ts:148-153`. Test: `backend/tests/test_scoring.py`, `backend/tests/test_api.py`.

**Interfaces:** Produces `night_clear(ctx: SkyContext, weather: dict[str, np.ndarray] | None, darkness: str) -> dict | None` returning `{"start_utc", "end_utc", "minutes", "rule"}`. TypeScript: `TonightResponse.night_clear: NightClear | null`, exported `interface NightClear { start_utc: string; end_utc: string; minutes: number; rule: string }`.

- [ ] **Step 1: Write failing tests** using `flat_weather` from `test_scoring.py`:
  - `test_night_clear_all_clear`: cloud 0, precip 0 gives `minutes` within one sample step of the night's dark minutes.
  - `test_night_clear_none_when_overcast`: cloud 100 gives `None`.
  - `test_night_clear_none_without_weather`: `weather=None` gives `None`.
  - `test_night_clear_nan_is_not_clear`: NaN cloud across the first half of darkness gives a window starting in the second half.
  - `test_night_clear_thresholds_inclusive`: cloud 40, precip 30 is clear; cloud 40.1 is not.
  - `test_night_clear_longest_run`: two clear runs of different length returns the longer.
  - `test_night_clear_no_darkness`: high-latitude summer context (`TROMSO`) gives `None`.
  - API: `/api/tonight` includes `night_clear`, and it is `null` with `failing_provider`.
- [ ] **Step 2: Run.** Expected: FAIL (`night_clear` not importable).
- [ ] **Step 3: Implement** with `FAVORABLE_CLOUD_PCT`, `FAVORABLE_PRECIP_PCT`, `runs()`, and the same darkness mask `tonight_score` uses. End is `t[e] + step`, clipped to the end of darkness. Rule string matches `_favorable_window`. Wire into the `/tonight` response.
- [ ] **Step 4: Run backend tests.** Expected: pass.
- [ ] **Step 5: Commit** `feat(polish): compute the forecast-clear run of the night`.

### Task 4: Night headline and NightStrip

**Files:** Create `frontend/src/lib/nightHeadline.ts`, `frontend/src/components/tonight/NightStrip.tsx`, `frontend/src/lib/useElementWidth.ts`. Test: `frontend/src/lib/nightHeadline.test.ts`, `frontend/src/components/tonight/NightStrip.test.tsx`.

**Interfaces:**
- Consumes `NightClear`, `NightSummary`, `ForecastPayload`.
- Produces `roundHalfHourLocal(iso: string, tz: string): string`; `nightHeadline(a: { clear: NightClear | null; darkMinutes: number; darkStartUtc: string | null; darkEndUtc: string | null; hasForecast: boolean; forecastMessage: string | null; tz: string }): { title: string; detail: string }`; `NightStrip({ night, forecast, clear, bestWindow, tz })`.

- [ ] **Step 1: Write failing tests.** Headline copy is exact:

| Case | title | detail |
|---|---|---|
| no forecast | `No forecast yet` | provider message |
| forecast, no run | `No forecast-clear darkness` | `Cloud or rain is forecast through all 10 h 45 min of darkness.` |
| run covers darkness (within 6 min) | `Clear all night` | `10 h 45 min of 10 h 45 min of darkness is forecast clear.` |
| starts at dusk (within 6 min) | `Clear until about 01:30` | `7 h 10 min of 10 h 45 min of darkness is forecast clear.` |
| ends at dawn | `Clears around 22:30` | same pattern |
| middle | `Clear about 21:00–01:30` | same pattern |

  `roundHalfHourLocal`: 01:35 EST rounds to `01:30`; in `Asia/Kathmandu` (+05:45) a time of 20:10 UTC (01:55 local) rounds to `02:00`.
  NightStrip: one rendered cell per hourly value in range; a null `cloud_cover` draws no cloud rectangle; with no hourly data it shows `No forecast this far ahead` and no clear bar; a Moon rect is present only when `moon_alt_deg > 0` within the span; hour labels use the observer's zone (run with `night` in `America/New_York`, expect labels `18`, `20`); a screen-reader table lists exact values.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** SVG drawn at the measured width so text is true size (`useElementWidth`, default 752 in jsdom): `viewBox="0 0 {W} {H}"`, top label row 26 px, bar 104 px (78 px and 3-hourly labels when `W < 480`), Moon band 5 px, axis 24 px. Dark start and end come from `night.dark_intervals`. Layers as rendered in the prototype's SVG: twilight `linearGradient` from `night.events`, cells with opacity `cloud/100 × 0.82`, clear bar, best-2-h marker, Moon band. Hover and tap set a line below the strip: `{HH:MM}: cloud {c} %, rain chance {p} %`. Colours are CSS variables; add `--strip-day/civil/nautical/dark` and `--cloud` to both palettes using the prototype's values.
- [ ] **Step 4: Run frontend checks.** Expected: pass.
- [ ] **Step 5: Commit** `feat(polish): night headline wording and hour-by-hour night strip`.

### Task 5: Score panel and Tonight layout

**Files:** Modify `frontend/src/components/tonight/ScoreHero.tsx`, `frontend/src/components/tonight/Conditions.tsx`, `frontend/src/pages/TonightPage.tsx`, `frontend/e2e/smoke.spec.ts:17-20`. Test: `frontend/src/components/components.test.tsx`.

**Interfaces:** Consumes Task 4. Produces `FactsRow({ night, forecast })` from `Conditions.tsx`. `ScoreBreakdown` and `SegmentedScoreBar` keep their exports because `TargetDetail` uses them.

- [ ] **Step 1: Write failing tests:** with a score, the panel shows the rounded total and `for the best 2 hours,` plus the window; "Heuristic" is visible; the breakdown sits inside a `<details>` whose summary is `Why this score`; a `no_weather` score shows `No score` and the partial total with no number; the page `h1` is `Tonight` when the date is the automatic night, otherwise the formatted date.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the layout from the prototype: two-column grid, score panel then strip panel containing `NightStrip`, `FactsRow`, tip line, `ForecastMeta`. `<h2 class="sr-only">Tonight's Score</h2>` keeps the landmark. Remove the `ConditionTiles` and `NightTimeline` usage from Tonight and delete `ForecastMetaInline`. Keep "How this score is calculated" inside the disclosure. Delete `NightTimeline.tsx` if nothing else imports it, and remove it from `LazyCharts.tsx`.
- [ ] **Step 4: Update e2e, each change deliberate:** line 18 `Heuristic planning estimate` becomes `/Heuristic/`; line 20 drops `Components sum to`, which is now inside a closed disclosure. Run frontend checks and e2e. Expected: pass.
- [ ] **Step 5: Commit** `feat(polish): score panel tied to its window, with the night in plain words`.

### Task 6: Target card and framing diagram

**Files:** Create `frontend/src/components/targets/FramingDiagram.tsx`. Modify `frontend/src/components/targets/TargetCard.tsx`, `frontend/src/pages/TonightPage.tsx`. Test: `frontend/src/components/components.test.tsx`.

**Interfaces:** Produces `FramingDiagram({ major, minor, fovDeg, size? })` and `framingNote(major: number | null, fovDeg: number | null): { text: string; warn: boolean } | null` with thresholds on `major / (fovDeg × 60)`: above 1 `Larger than the field` (warn); at least 0.75 `Fills the field`; at most 0.15 `Small in the field`; otherwise `Fits the field`. Null inputs return null.

- [ ] **Step 1: Write failing tests:** the four `framingNote` thresholds and the nulls; the card shows name, score, window, and `{clear} clear` from `score.forecast_window.minutes`; adds `of {up} up` only when more than one minute shorter than `observable_minutes`; hides the designation when it equals the name; the name is a button that opens details, and the add button does not open details when clicked.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The FOV is always a dashed circle, never a rectangle; ellipse from catalog size, unrotated. The card is an `<article>` whose name button has a stretched `::after` covering the card, so there are no nested interactives; the 44 px add button sits above it with `position: relative; z-index: 1`. Show `HistoryBadge` and at most one caution. Move a fact shared by every shown card (for example Moon down) to one line above the grid. Grid: three columns only when the Session plan panel is not alongside; two beside it.
- [ ] **Step 4: Run frontend checks and e2e.** Expected: pass.
- [ ] **Step 5: Commit** `feat(polish): compact target cards with framing diagrams`.

### Task 7: Sky image provider and route

**Files:** Create `backend/app/sky_images.py`. Modify `backend/app/main.py:32-43`, `backend/app/api.py`, `backend/app/catalog.py`, `.gitignore`. Test: `backend/tests/test_sky_images.py`.

**Interfaces:** Produces:
- `sky_field_arcmin(target_id: str, major: float | None) -> int`: `clamp(round(1.5 × major), 40, 120)`, `None` gives 40, override `SKY_FIELD_OVERRIDES = {"ic1396": 120}`.
- `class SkyImageProvider(cache_dir: Path, fetch: Callable[[float, float, int], bytes] = default_fetch, enabled: bool = True, min_interval_s: float = 1.0, retry_after_s: float = 3600.0, now: Callable[[], float] = time.time, sleep: Callable[[float], None] = time.sleep)` with `get(target_id: str, ra_deg: float, dec_deg: float, field_arcmin: int) -> Path | None`.
- Route `GET /api/targets/{target_id}/sky-image`: `FileResponse` JPEG with `Cache-Control: public, max-age=604800`; 404 for an unknown target; 503 when unavailable.
- Every target dict gains `sky_field_arcmin: int`. `create_app(..., sky_images: SkyImageProvider | None = None)`, stored on `app.state.sky_images`.

- [ ] **Step 1: Write failing tests** with a fake `fetch` returning a Pillow-made GIF, and a `tmp_path` cache:
  - width rule: major 9.27 gives 40, 60 gives 90, 210 gives 120, `None` gives 40, `ic1396` gives 120.
  - miss then hit: second `get` makes no fetch and returns the same path; the file is a JPEG no larger than 480 px on its long side.
  - `test_html_body_is_failure`: fetch returns `b"<HTML><TITLE>Error</TITLE>"`; `get` returns `None` and writes nothing.
  - failure back-off: no second fetch within `retry_after_s`; a fetch is allowed after it.
  - `test_one_upstream_request_for_concurrent_callers`: eight threads, fake fetch records calls and blocks briefly; one call total.
  - spacing: two different targets call `sleep` so requests are at least `min_interval_s` apart.
  - edge trim: a GIF with a white 5 % right band has no saturated last column in the JPEG; a band over 15 % returns `None`.
  - disabled: `enabled=False` returns `None` without fetching.
  - route: 200 `image/jpeg`; 404 unknown; 503 when unavailable.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `default_fetch` calls `https://archive.stsci.edu/cgi-bin/dss_search` with `v=poss2ukstu_red&r={ra}&d={dec}&e=J2000&h={f}&w={f}&f=gif`, 60 s timeout, using the existing `USER_AGENT`. Accept only bodies starting `GIF8`. One `threading.Lock` around fetching, re-checking the cache after acquiring it. Convert to greyscale; trim rows and columns from the outside while their mean is at least 250; centre-crop square; downscale to 480 px; JPEG quality 80; write to a temp file then `os.replace`. Cache dir from `ASTROPLANNER_SKY_CACHE_DIR`, default `backend/data/sky-images`; `ASTROPLANNER_SKY_IMAGES=off` disables. Add the path to `.gitignore`. Default provider in tests must be disabled, so `make_client` passes one with a failing fake.
- [ ] **Step 4: Run backend tests.** Expected: pass.
- [ ] **Step 5: Commit** `feat(polish): cached DSS sky images behind a rate-limited provider`.

### Task 8: Sky images in the interface, with credit

**Files:** Create `frontend/src/components/targets/SkyThumb.tsx`. Modify `TargetCard.tsx`, `TargetDetail.tsx`, `frontend/src/api/types.ts:7`, `backend/app/api.py:122` (the data-source list Settings renders; add an optional `acknowledgment` field if the row needs one), `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/TonightPage.tsx`, `frontend/e2e/smoke.spec.ts`. Test: `frontend/src/components/components.test.tsx`.

**Interfaces:** Consumes `Target.sky_field_arcmin`, `FramingDiagram`. Produces `SkyThumb({ target, fovDeg, size })`.

- [ ] **Step 1: Write failing tests:** the diagram shows until the `<img>` fires `load`, then the image has `data-loaded`; on `error` the image is removed and the diagram stays; the width label shows `{field/60}°`, with 40′ as `0.67°`; the `<img>` has `loading="lazy"` and the class `vision-img`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Image `opacity` 0 to 1 over `--dur-small`. Drawer shows image and diagram side by side. Credit line under the grid: `Sky images: Digitized Sky Survey, red plates, scaled to each object with the width marked on the picture. © AURA and the plate copyright holders; used for non-profit purposes.` Settings → Data sources gains a DSS row with the full acknowledgment copied verbatim from `https://archive.stsci.edu/dss/acknowledging.html`, fetched during this task. If that page cannot be read, stop and report; do not paraphrase.
- [ ] **Step 4: E2E:** route-stub `**/sky-image` to a small JPEG in `smoke.spec.ts` and assert a card shows it; a second test stubs 503 and asserts the diagram. Run frontend checks and e2e. Expected: pass.
- [ ] **Step 5: Commit** `feat(polish): sky images on cards and in details, with fallback and credit`.

### Task 9: Overlays, disclosures and loading

**Files:** Create `frontend/src/components/ui/Overlay.tsx`. Modify `TargetDetail.tsx`, `ConfirmDialog.tsx`, `ScoreHero.tsx`, `AstroLogImportPage.tsx:575`, `App.tsx:24-30`, `frontend/src/lib/vision.ts`, `index.css`. Test: `frontend/src/components/ui/Overlay.test.tsx`.

**Interfaces:** Produces `Overlay({ open, onClosed, variant: "drawer" | "modal", labelledBy, children, panelRef? })`. DOM: a full-viewport transparent `<dialog class="overlay">` holding `<div class="overlay-scrim">` and `<div class="overlay-panel">`. Motion runs on those two real elements, so a drag can set their styles directly, which `::backdrop` does not allow. `data-state` is `open` or `closing`.

- [ ] **Step 1: Write failing tests** with fake timers:
  - opening calls `showModal`, and `data-state` becomes `open`.
  - closing sets `closing`, and `close()` runs after `transitionend`, or after 260 ms if none arrives.
  - `test_reopen_during_close`: open, close, open before the timer: the dialog stays open and `onClosed` is not called.
  - `test_unmount_while_open`: unmounting leaves no open dialog and no pending timer.
  - Esc (`cancel` event) runs the close path; a scrim click closes; a panel click does not.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Drawer: `translate3d(100%,0,0)` to none, `--dur-in` `--ease-drawer`, exit `--dur-out`. Modal: `opacity 0, scale(0.96)` to settled, 180 ms in, 120 ms out, centred. Scrim shares the panel's timing. Move `TargetDetail` and `ConfirmDialog` onto it. `TargetDetail` keeps showing its last target while closing. Disclosures use `::details-content` (block-size 200 ms, opacity 150 ms) with `interpolate-size: allow-keywords`; chevron rotates over 180 ms. `PageLoading` becomes a page-shaped skeleton shown only after 200 ms. `applyVision` runs inside `document.startViewTransition` at 200 ms when supported and motion is not reduced. Reduced motion: overlays fade and do not move.
- [ ] **Step 4: Run frontend checks and e2e.** Expected: pass.
- [ ] **Step 5: Commit** `feat(polish): animated overlays, disclosures and calmer loading`.

### Task 10: Phone sheet gesture and header

**Files:** Create `frontend/src/lib/sheetDrag.ts`, `frontend/src/components/ui/useSheetDrag.ts`. Modify `Overlay.tsx`, `TargetDetail.tsx`, `HeaderControls.tsx`, `TonightPage.tsx`, `AppShell.tsx`. Test: `frontend/src/lib/sheetDrag.test.ts`, `frontend/src/components/components.test.tsx`.

**Interfaces:** Produces `shouldDismiss(dy: number, velocityPxPerMs: number, height: number): boolean` (true when `dy > 0.35 × height` or velocity above `0.5`) and `dragPosition(dy: number): number` (`dy` when positive, `-(|dy| ** 0.6)` when negative). `useSheetDrag(panelRef, scrimRef, onDismiss)` returns pointer handlers for the sheet's top region.

- [ ] **Step 1: Write failing tests:** the pure functions at their boundaries, including a slow drag past nothing returning false and a fast short flick returning true; pressing a button inside the top region starts no drag; on a narrow viewport the header renders one row with a `{location} · {scope}` chip that opens a sheet holding the location, equipment and date controls.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Below 640 px the drawer is a bottom sheet at 88 % height with safe-area bottom padding and `overscroll-behavior: contain`. On pointer down read the panel's live `translateY` from `getComputedStyle` so a closing sheet can be caught, set `transition: none`, and capture the pointer. Write `transform` on the panel and `opacity` on the scrim directly; no React state during a drag. On release remove inline styles and close or settle using the existing transitions. `touch-action: none` on the top region only. Add 44 px icon targets on phones and change the strip hint to touch-aware wording.
- [ ] **Step 4: Run frontend checks and e2e on both projects.** Expected: pass.
- [ ] **Step 5: Commit** `feat(polish): draggable phone sheet and one-row phone header`.

### Task 11: Night vision

**Files:** Modify `frontend/index.html`, `frontend/src/index.css`, `HeaderControls.tsx`, `TargetFilters.tsx`, plus other native `select`/date uses found in the audit. Test: `frontend/src/index.css.test.ts`, `frontend/e2e/smoke.spec.ts`.

**Interfaces:** Produces an inline SVG filter `#vision-red`; `.vision-img` uses `filter: url(#vision-red)` in night vision.

- [ ] **Step 1: Write failing tests:** `index.css` no longer contains `sepia(` in the `.vision-img` rule; `index.html` contains a `feColorMatrix` with values `.17 .33 .06 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0`; `--color-muted` in the night palette is `#a23a30`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement the filter and contrast change.** Run frontend checks and commit `fix(polish): red-only image filter and readable muted text in night vision`.
- [ ] **Step 4: STOP for a decision.** Ask the developer to run `/pick-ui-library` for the themed select and date controls. Native popups are drawn by the OS and may not be red. Implement with the chosen primitive; keep accessible labels; add an e2e check that opening the header's location control in night vision shows no non-red text colour.
- [ ] **Step 5: Run frontend checks and e2e. Commit** `feat(polish): themed controls so night vision stays red`.

### Task 12: Remaining screens

**Files:** Modify `frontend/src/pages/LibraryPage.tsx`, `TargetLogPage.tsx`, `StarPage.tsx`, `VariableHunterPage.tsx`, `ExplorePage.tsx`, `frontend/src/components/astrolog/TargetTile.tsx`, `frontend/src/components/processing/NightReport.tsx`, `frontend/src/components/variables/*`. Test: existing suites, plus additions in `variables.test.tsx`.

- [ ] **Step 1: Write failing tests:** Star page no longer renders `Planned for a later phase`; Variable Hunter list omits `Your nights: 0` when the count is zero; Explore rows hide the designation when it equals the name and show no repeated `Observable during darkness` for observable rows.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Star page: the Tonight, Your nights and Seestar-fit facts become one summary panel. Library tiles adopt the card's press state and hover border. Coach report chart card aligns to its own height (`self-start`). The Phase 3 assertion tied to the "later phase" text is the one earlier-phase test that changes; record it in `PROGRESS.md`.
- [ ] **Step 4: Run frontend checks and e2e.** Expected: pass.
- [ ] **Step 5: Commit** `feat(polish): carry the polish through the remaining screens`.

### Task 13: Validate and hand over

**Files:** Modify `README.md`, `PROGRESS.md`, `ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/screenshots/`.

- [ ] **Step 1:** Run all suites and record exact counts in `PROGRESS.md`.
- [ ] **Step 2:** Run the `break-ui` skill on Tonight cards and Library; fix what breaks; remove its demo toggle and fixtures before committing.
- [ ] **Step 3:** Run the `animation-performance` skill on the sheet and scrim.
- [ ] **Step 4:** Ask the developer to run `/review-animations`, and fix findings.
- [ ] **Step 5:** Browser check on desktop, 390 px and night vision. Re-shoot `docs/screenshots/` showing no survey images, personal paths or coordinates.
- [ ] **Step 6:** Ask the developer to test on a real phone and in a dark room. Record what was and was not confirmed. Opening the dev server to the home network is the developer's decision.
- [ ] **Step 7:** Update docs. Commit `docs(polish): validation evidence and updated screenshots`.
- [ ] **Step 8:** Developer review, then merge and tag `polish-1`, only on the developer's instruction.
