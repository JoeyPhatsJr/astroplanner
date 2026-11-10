# Polish Pass 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tune Inter (optical sizing, tracking per size, tabular digits only on numbers), give each fact on Tonight one home, replace boxes with grouped lists, and make night vision's two text levels pass WCAG AA.

**Architecture:** Type and colour live in `frontend/src/index.css` (`@theme` tokens plus the `[data-vision="night"]` block), so most of the pass is token changes plus deleting per-component overrides. Page work is markup inside existing components. One backend change shortens `fit_notes` copy in `backend/app/scoring.py`.

**Tech Stack:** React 19, TypeScript, Tailwind 4 (CSS-first `@theme`), Vitest + Testing Library, Playwright (projects `desktop` 1440×900 and `mobile` Pixel 7), FastAPI + pytest.

**Spec:** `docs/superpowers/specs/2026-11-10-polish-pass-2-design.md`. Mockup: `.superpowers/brainstorm/polish2/index.html` (git-ignored; serve with `python3 -m http.server` from that folder).

## Global Constraints

- No new dependencies. Inter stays; import `@fontsource-variable/inter/opsz.css`.
- Never use the CSS `font:` shorthand in type rules: it resets `font-feature-settings` and `font-variant-numeric`.
- `body` font features: `"cv11" 1` only. Digits that align (times, scores, durations, percentages, coordinates, chart ticks, calendar days) use `tabular-nums`.
- No `tracking-tight`, `tracking-[…]` or `tracking-wider` remains in `frontend/src` after Task 1; tracking comes from the scale.
- Night vision: `--color-ink` #ee5a4b, `--color-ink-2` #d24c3f, `--color-muted` #d24c3f, `--color-ice` #ff5a47; every text token at least 4.5:1 against `--color-night`, `--color-night-deep` and `--color-panel-2`.
- No em-dash (U+2014) in user-visible strings. En-dashes in ranges stay.
- No score, calculation or data-source change. Motion tokens and durations are unchanged.
- CLAUDE.md requirement 5: wherever framing notes appear, the S30 FOV-axis caveat appears at least once on that surface.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commits stay on `worktree-polish-pass-2`; no push or merge.
- Run before each commit:
  - Frontend, from `frontend/`: `npx tsc -b`, `npx vitest run`, `npm run build`.
  - Backend, from `backend/`: `.venv/bin/python -m pytest -q`.
  - Playwright (`npx playwright test`) once per task that touches pages.

## Review Focus

1. **Long target names** ("Little Dumbbell Nebula", "IC 1396 (Elephant's Trunk region)") wrap cleanly in cards and Explore rows after tracking changes. The score never drops below the name. Pinned by the Task 5 card test with a 40-character name.
2. **Non-S30 equipment with a known FOV axis** (a custom profile with `fov_definition: "horizontal"`): notes show no "unverified" caveat and the Tonight intro omits the sentence. Pinned in Task 3.
3. **Explore with "Observable only" on:** the "Not observable tonight" group does not render (no empty heading). Pinned in Task 6.
4. **Night vision on every page:** button text on accent fills stays readable (`--color-on-accent` #140000 on #ff5a47). Pinned by the Task 2 contrast test, which includes the pair `on-accent`/`ice`.
5. **Touch devices with a mouse (iPad with trackpad):** reports `hover: hover`, so it shows the hover hint. Accepted; `(hover: none)` alone decides.

---

### Task 1: Type foundation

**Files:**
- Modify: `frontend/src/index.css` (`@import` line 2, `@theme` type scale lines 15-22, `body` rule lines 128-134)
- Modify: every `frontend/src/**/*.tsx` that uses `tracking-tight`, `tracking-[-0.03em]`, `tracking-wider`, `text-4xl`, `text-5xl`, `text-[1.35rem]` (34 + 3 sites; list them with `grep -rn "tracking-\|text-4xl\|text-5xl\|text-\[1.35rem\]" src --include='*.tsx'`)
- Modify: numeric sites that need `tabular-nums` (at minimum `components/tonight/ScoreHero.tsx`, `Conditions.tsx`, `NightStrip.tsx` axis, `components/targets/TargetCard.tsx`, `pages/ExplorePage.tsx` Row, `components/ui/NightPicker.tsx` (already tabular in CSS; check), `components/layout/HeaderControls.tsx` night label, chart tick text in `components/charts/*`)
- Test: `frontend/src/styles/typeScale.test.ts` (new)
- Test: `frontend/e2e/smoke.spec.ts` (add one test)

**Interfaces:**
- Produces: utility `text-score` (76px / 0.9 / -0.035em), `text-display` now 40px / 1.05 / -0.02em, per-size tracking on `text-xs` … `text-3xl` (spec table). Later tasks use these names and never add tracking utilities.

- [ ] **Step 1: Write the failing unit test** `typeScale.test.ts`. It reads `../index.css?raw` and every component source via `import.meta.glob("../**/*.tsx", { query: "?raw", eager: true, import: "default" })`, excluding `*.test.tsx`, and asserts:
  - `css` contains `@import "@fontsource-variable/inter/opsz.css"`, and does not contain `@import "@fontsource-variable/inter";`.
  - The `body` rule's `font-feature-settings` is exactly `"cv11" 1`. Extract it with `/body\s*{[^}]*}/`.
  - `@theme` defines these values:
    - `--text-xs--letter-spacing: 0.01em`
    - `--text-lg--letter-spacing: -0.005em`
    - `--text-xl--letter-spacing: -0.008em`
    - `--text-2xl--letter-spacing: -0.011em`
    - `--text-3xl--letter-spacing: -0.014em`
    - `--text-display: 2.5rem`, `--text-display--letter-spacing: -0.02em`
    - `--text-score: 4.75rem`, `--text-score--line-height: 0.9`, `--text-score--letter-spacing: -0.035em`
    - the line heights from the spec table
  - No source file matches `/\btracking-(tight|wider|\[)/` or `/\btext-(4xl|5xl|\[1\.35rem\])/`. On failure, list the offending files.
- [ ] **Step 2: Run** `npx vitest run src/styles/typeScale.test.ts`. Expected: FAIL on the import, `body` and theme assertions, and on the list of files that use tracking.
- [ ] **Step 3: Change `index.css`:**
  - Import `@fontsource-variable/inter/opsz.css`.
  - Add the scale entries to `@theme`. Tailwind 4 reads `--text-<name>--line-height` and `--text-<name>--letter-spacing` and applies them with the size utility.
  - Set `body` `font-feature-settings: "cv11" 1`.
  - Keep `--text-micro` and `--text-label` as they are.
- [ ] **Step 4: Delete `tracking-*` from every listed `.tsx`.**
  - Map `text-5xl` (`AstroLogImportPage.tsx:371`) to `text-score`.
  - Map `text-4xl` (`StarExplainer.tsx:8`) to `text-display`.
  - Map `text-[1.35rem]` (`AppShell.tsx:94`) to `text-xl`.
  - Map the ScoreHero numeral to `text-score`. Its existing class sets its size and tracking; replace both.
  - Add `tabular-nums` to the numeric sites listed under Files.
- [ ] **Step 5: Run** `npx vitest run src/styles/typeScale.test.ts`. Expected: PASS.
- [ ] **Step 6: Add a Playwright test** in `smoke.spec.ts`: "type: digits are tabular only where they align". It opens `/` and asserts:
  - `getComputedStyle(document.body).fontFeatureSettings` does not contain `tnum`.
  - The score numeral (`getByTestId("score-total")`; add that `data-testid` in ScoreHero) has `fontVariantNumeric` containing `tabular-nums`.
  - `document.fonts.check('600 40px "Inter Variable"')` is true.
- [ ] **Step 7: Run all suites** (Global Constraints) plus `npx playwright test e2e/smoke.spec.ts`.
  - Compare Tonight at 1440 and 390 px against the mockup's Type screen.
  - Check that long card names still wrap (Review Focus 1).
- [ ] **Step 8: Commit** `feat(type): Inter optical sizing, tracking per size, tabular digits only on numbers`.

### Task 2: Night-vision text levels and links

**Files:**
- Modify: `frontend/src/index.css` night block (lines 75-108); add a rule after it for night links
- Test: `frontend/src/styles/nightContrast.test.ts` (new)
- Test: `frontend/e2e/smoke.spec.ts` (add one test)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `:root[data-vision="night"] a.text-ice:not(.btn)` underlined (`text-decoration-line: underline; text-underline-offset: 2px`).

- [ ] **Step 1: Write the failing test** `nightContrast.test.ts`.
  - Parse the `:root[data-vision="night"] { … }` block from `../index.css?raw` into a token map.
  - Implement WCAG relative luminance and contrast inline. The formula is short: sRGB → linear → `0.2126 R + 0.7152 G + 0.0722 B`, then `(L1 + 0.05) / (L2 + 0.05)`.
  - Assert ≥ 4.5 for each of `--color-ink`, `--color-ink-2`, `--color-muted`, `--color-ice` against each of `--color-night`, `--color-night-deep`, `--color-panel-2`.
  - Assert ≥ 4.5 for `--color-on-accent` against `--color-ice`.
  - Assert `--color-ink` ≥ 1.2 × the contrast of `--color-ink-2` against `--color-night`, so the levels stay distinct.
- [ ] **Step 2: Run** `npx vitest run src/styles/nightContrast.test.ts`. Expected: FAIL. Today `ink-2` is 3.66 and `muted` is 3.16.
- [ ] **Step 3: Set the four tokens** to the Global Constraints values and add the night link rule.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Add a Playwright test** "night vision: inline links are underlined". Open `/`, press the night-vision button, and assert that the link "Set your own location" has `textDecorationLine` `underline`.
- [ ] **Step 6: Run all suites** and Playwright. Screenshot Tonight at 1440 px in night vision and compare it with the mockup's Night view.
- [ ] **Step 7: Commit** `feat(night): two AA red text levels and underlined links in night vision`.

### Task 3: Shorter framing notes, caveat stated once

**Files:**
- Modify: `backend/app/scoring.py:237-252` (`fit_notes`)
- Test: `backend/tests/test_scoring.py` (add tests; find the existing `fit_notes` tests with `grep -n fit_notes backend/tests/*.py`)
- Modify: `frontend/src/pages/TonightPage.tsx` (targets intro, around line 104-140)
- Test: `frontend/src/pages/TonightPage.test.tsx` if it exists, else `frontend/src/components/components.test.tsx`

**Interfaces:**
- Consumes: equipment dict keys `fov_deg`, `fov_definition` (backend); `Equipment.fov_definition: FovDefinition` and `fov_deg` (frontend `api/types.ts:267`).
- Produces: notes with this exact copy (`major` and `fov` formatted as today: `:.0f` for large, `:.1f` for small):
  - `Larger than the ~{fov}′ field ({major}′ across): expect partial framing or a mosaic.`
  - `Fills most of the ~{fov}′ field ({major}′ across).`
  - `Small in the ~{fov}′ field: {major}′ across.`
  - The "Catalog size unavailable…" note is unchanged.
  - No note contains "(FOV axis unverified)".

- [ ] **Step 1: Write failing pytest cases.** With `equipment = {"fov_deg": 2.46, "fov_definition": "unknown"}`:
  - major 178 → `["Larger than the ~148′ field (178′ across): expect partial framing or a mosaic."]`
  - major 120 → `["Fills most of the ~148′ field (120′ across)."]`
  - major 9.3 → `["Small in the ~148′ field: 9.3′ across."]`
  - With `fov_definition: "horizontal"` and major 178: the same text. The caveat no longer lives in notes for either definition.
- [ ] **Step 2: Run** `.venv/bin/python -m pytest -q backend/tests -k fit_notes`. Expected: FAIL.
- [ ] **Step 3: Change the three f-strings** and remove `qual`.
- [ ] **Step 4: Run.** Expected: PASS. Then run the full backend suite and fix any test that matched the old strings.
- [ ] **Step 5: Write a failing frontend test** for the Tonight targets intro, rendered with mocked API data.
  - With equipment `fov_definition: "unknown"`, `fov_deg: 2.46`, the intro contains "Field sizes assume about 148′ across; the Seestar S30 (original) FOV axis is unverified." Build it from `eq.name` and `Math.round(fov_deg * 60)`.
  - With `fov_definition: "horizontal"`, that sentence is absent (Review Focus 2).
- [ ] **Step 6: Implement it** in the targets intro paragraph, then run the test. Expected: PASS.
- [ ] **Step 7: Run all suites.** Commit `feat(targets): shorter framing notes; FOV-axis caveat stated once per surface`.

### Task 4: Tonight composition

**Files:**
- Modify: `frontend/src/components/ui/PageHeader.tsx` (add a `notice?: ReactNode` prop, rendered under the subtitle as `<p className="mt-2 text-sm text-ink-2">`)
- Modify: `frontend/src/pages/TonightPage.tsx:54-73` (subtitle, notice) and `:194-210` (one conditions panel)
- Modify: `frontend/src/components/tonight/ScoreHero.tsx` (drop its own `panel` wrapper so it sits inside the shared panel; replace the dashed Heuristic badge with `badge`)
- Modify: `frontend/src/components/tonight/NightStrip.tsx` (remove the visible "forecast clear · …" label, keeping it `sr-only`; add a touch hint beside line 242)
- Test: `frontend/src/components/ui/PageHeader.test.tsx` (new or existing), `frontend/src/components/tonight/NightStrip.test.tsx` (existing or new), `frontend/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `PageHeader({ title, subtitle, back, actions, notice })`. Task 7 uses `notice` nowhere; only Tonight uses it.
- Strip hint markup:
  - `<span className="[@media(hover:none)]:hidden">Hover over the strip for hourly values.</span>`
  - `<span className="hidden [@media(hover:none)]:inline">Tap the strip for hourly values.</span>`

- [ ] **Step 1: Write failing tests.**
  - `PageHeader` renders `notice` content below the subtitle, and the notice is not inside the actions container.
  - `NightStrip`: the text "Tap the strip for hourly values." is in the document, and the clear-run label's text is still present but inside an element with class `sr-only`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The Tonight subtitle is `{location.label}<span className="text-muted tabular-nums"> · {formatLatLon(…)}</span>`. The `nightLabel(nightDate)` prefix and the `· {tz}` suffix are removed.
  - The sample notice moves to `notice` as a sentence with an inline link ("This is the editable sample location. Set your own location"), not a `Notice` box.
  - Conditions layout: one `section.panel` with grid `lg:grid-cols-[minmax(260px,320px)_1fr]`. ScoreHero goes in the left cell and the strip in the right cell. `FactsRow`, `stripTip` and `ForecastMeta` span both columns below, after a `border-t border-line-soft pt-4`.
  - Update `PageSkeleton` to one skeleton block of the same panel shape.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Add a Playwright test** in `smoke.spec.ts` for the mobile project only (`test.skip(testInfo.project.name !== "mobile")`). On `/`, "Tap the strip for hourly values." is visible and "Hover over the strip for hourly values." is hidden.
- [ ] **Step 6: Run all suites** and Playwright.
  - Check the subtitle on a non-tonight date: the title shows that date (existing `nightPageTitle`), and no date is lost.
  - Compare against the mockup at 1440 and 390 px.
- [ ] **Step 7: Commit** `feat(tonight): one conditions panel, date shown once, touch hint for the strip`.

### Task 5: Target card restraint

**Files:**
- Modify: `frontend/src/index.css` (add `.btn-tinted` next to `.btn-primary` at line 402, plus its hover rule inside the existing `(hover: hover)` block at line 389)
- Modify: `frontend/src/components/targets/TargetCard.tsx:120-140` (add button), and the score/name layout if Review Focus 1 needs it
- Modify: `frontend/src/components/targets/SkyThumb.tsx:32` and its overlay (field width only; the `framingNote` text leaves the thumb)
- Test: `frontend/src/components/targets/TargetCard.test.tsx` (existing or new)

**Interfaces:**
- Produces: `.btn-tinted`:
  - `background: color-mix(in srgb, var(--color-ice) 13%, transparent)`, `color: var(--color-ice)`, `border-color: transparent`.
  - Hover: 22 %.
  - It works in night vision because it uses tokens.

- [ ] **Step 1: Write failing tests.**
  - The add button's accessible name is unchanged (keep the existing `aria-label`). It has class `btn-tinted`, not `btn-primary`, and contains the visible text "Add" in an element with class `max-sm:sr-only`.
  - The in-session state keeps its current classes and name.
  - A card with a 40-character name renders the score element after the name element in DOM order, inside the same row container (Review Focus 1).
  - `SkyThumb` for a target larger than the field does not render the text "Larger than the field".
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The button keeps a minimum of 44 × 36 px (`min-h-9 min-w-11`) and drops `size-11`.
  - Label: `<Plus/> <span className="max-sm:sr-only">Add</span>`.
- [ ] **Step 4: Run the tests.** Expected: PASS. Then run all suites and Playwright.
  - The existing e2e "add to session" flow must still find the button by its name.
- [ ] **Step 5: Commit** `feat(targets): tinted add button; the score leads the card; thumbnails show the field width only`.

### Task 6: Explore grouped list

**Files:**
- Modify: `frontend/src/pages/ExplorePage.tsx:113-160` (list container and `Row`)
- Test: `frontend/src/pages/ExplorePage.test.tsx` (existing or new)

**Interfaces:**
- Consumes: `Recommendation.visibility.status` (`"observable"` and the others in `STATUS_TONE`), `status_text`, `status_detail`.
- Produces: two `ul` lists.
  - `aria-label="Targets"`: the observable list, unchanged name, so existing e2e selectors keep working.
  - `aria-label="Not observable tonight"`: preceded by `<h2 className="text-xl font-semibold">Not observable tonight</h2>`.

- [ ] **Step 1: Write failing tests** with mocked recommendations (two observable, two not).
  - With "Observable only" off, two lists render, and the second contains `status_text` and `status_detail` as text, with no element of class `badge`.
  - With "Observable only" on, there is no "Not observable tonight" heading (Review Focus 3).
  - Each list is one element with class `panel`; rows are not `.panel`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The list is `ul.panel.divide-y.divide-line-soft.overflow-hidden`.
  - The row button drops `panel` and uses `hover:bg-panel-2` plus a `focus-visible` inset outline.
  - `HistoryBadge` stays inside the `li`, below the button.
  - Not-observable rows show `{status_text}. {status_detail}` in `text-sm text-ink-2`.
- [ ] **Step 4: Run all suites** and Playwright. Screenshot Explore at 1440 and 390 px against the mockup.
- [ ] **Step 5: Commit** `feat(explore): one grouped list; not-observable targets in their own section`.

### Task 7: Star page

**Files:**
- Modify: `frontend/src/pages/StarPage.tsx`, `frontend/src/components/variables/StarExplainer.tsx`
- Test: `frontend/src/pages/StarPage.test.tsx` (existing or new; check `frontend/e2e/variables.spec.ts` selectors before renaming anything)

- [ ] **Step 1: Write failing tests.**
  - The star page renders a `dl` containing the terms "Tonight", "Seestar fit" (its current label text; keep it) and "Light curve".
  - "How to read a variable star" is not inside an element with class `panel`.
  - The explainer list has class `max-w-[68ch]`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `dl` grid: `grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]`. Terms use `text-sm font-semibold text-ink-2`; descriptions use `max-w-[62ch]`.
  - Mission cards are unchanged.
- [ ] **Step 4: Run all suites** and Playwright. Compare with the mockup's Star page screen.
- [ ] **Step 5: Commit** `feat(variables): star page facts as a list, prose at reading width`.

### Task 8: Badges, dashes, docs

**Files:**
- Modify: `frontend/src/index.css` `.badge` (line 421; add `.badge-accent`)
- Modify: every `className="badge border-ice/40 text-ice"`:
  - `SettingsPage.tsx:94,106,412,435`
  - `AdviceList.tsx:19`, `NightReport.tsx:108`, `SelectionStep.tsx:71`
  - the `observable` tone in `ExplorePage.tsx:18`, if still used after Task 6
- Modify: `components/processing/CompareStep.tsx:129,144`, `pages/AstroLogImportPage.tsx:43` (em-dashes)
- Modify: `PROGRESS.md`, `ROADMAP.md` (decision log 2026-11-10)
- Test: `frontend/src/styles/typeScale.test.ts` (extend)

- [ ] **Step 1: Extend the guard test.**
  - No source `.tsx` contains `border-ice/40 text-ice` or the character U+2014 inside a JSX text node or string literal. Check lines that are not comments: strip `//…` and `/* … */` before matching.
  - `index.css` defines `.badge-accent`.
- [ ] **Step 2: Run it.** Expected: FAIL, listing the files.
- [ ] **Step 3: Implement.**
  - `.badge-accent`: `border-color: transparent; background: color-mix(in srgb, var(--color-ice) 13%, transparent); color: var(--color-ice)`.
  - Replace the variants.
  - `CompareStep` placeholders become `–`.
  - The import message becomes `${n} image${…} not imported: choose a final picture on the target page.`
- [ ] **Step 4: Run all suites** and Playwright.
- [ ] **Step 5: Update the docs.**
  - `PROGRESS.md`: current work, exact test counts, limitations (dark-room check, the 25 kB font cost, other screens not mocked).
  - `ROADMAP.md`: a Polish 2 row and these decision-log entries: Inter tuned, night levels, the en-dash ruling, the caveat once per surface.
- [ ] **Step 6: Commit** `chore(polish-2): two badge styles, no em-dashes, progress and roadmap`.
