# Polish pass 2: type, hierarchy and night vision

**Date:** 2026-11-10
**Branch:** `worktree-polish-pass-2` (from `main` at 0ad8aae, after PR #4)
**Skills:** `apple-design` (typography, materials, restraint, feedback), `design-taste-frontend` (consistency locks, copy, cards versus spacing). The taste skill targets landing pages and excludes dense product UI (its section 13), so only its typography, consistency, restraint and copy rules apply here.
**Mockup:** `.superpowers/brainstorm/polish2/index.html` (git-ignored; real data from 10 Nov, Philadelphia sample). Approved by the developer on 2026-11-10 ("looks good").
**Typeface decision:** keep Inter, tuned (developer's choice over Geist or the system font).

## Problem

An audit of the merged app found that the first polish pass fixed motion, phone and night-vision colour, but the type system, information hierarchy and night-vision legibility still read as unfinished:

1. `index.css:132` sets `font-feature-settings: "tnum"` on `body`. Tabular figures widen punctuation: a hyphen measured 9.08 px against 6.45 px, so "Open-Meteo" renders as "Open - Meteo" and prose runs about 8 % wider.
2. One letter-spacing value (`tracking-tight`, -0.025em) is used 34 times on every heading size from 16 px to 48 px.
3. The installed `@fontsource-variable/inter` 5.3.0 ships an optical-size axis (`opsz.css`), but the app imports the weight-only file.
4. 13 type sizes are in use, including one-offs (`text-4xl`, `text-5xl`, `text-[1.35rem]`).
5. Tonight states the clear hours three times and the date three times. Nine saturated 44 px add buttons outweigh the scores. Every target card repeats "(FOV axis unverified)".
6. Explore draws 58 separately bordered rows; the star page stacks five bordered boxes; prose runs about 140 characters per line.
7. Night vision's three text reds are nearly identical, and two of them fail WCAG AA: `ink-2` #b83a31 is 3.66:1 and `muted` #a23a30 is 3.16:1 on #050000. Links cannot be told from text.
8. Copy: phones get no hint for the night strip (the hover hint is hidden on touch and nothing replaces it); three em-dashes; six badge styles.

## Goals

- Type that changes shape with size: optical sizing on, tracking per size, tabular digits only where digits align.
- One home for each fact on Tonight; the score is the strongest element on a target card.
- Grouped lists instead of boxes around everything; cards only for things you act on.
- Night vision with two red text levels that both pass WCAG AA, and underlined links.

## Non-goals

- No new dependencies, no typeface change, no layout changes to Settings, AstroLog, Import or the processing coach beyond the shared type, badge and copy rules.
- No motion changes (pass 1 covered motion). No landing-page work (another branch owns it).
- No change to any score, calculation or data source.

## Design

### 1. Type system (all pages)

- Import `@fontsource-variable/inter/opsz.css` instead of the default weight-only file. `font-optical-sizing: auto` is the CSS default, so Inter picks its text cut (opsz 14) for small text and its display cut (opsz 32) for headings. Cost: the Latin file grows from 48 kB to 73 kB.
- `body` keeps `"cv11"` and drops `"tnum"`. Times, scores, durations, percentages, coordinates, chart ticks and calendar days get Tailwind's `tabular-nums` (`font-variant-numeric`). Prose and labels use proportional figures.
- Tracking and leading move into the Tailwind scale in `@theme`, so the existing utility names carry them and `tracking-tight` is deleted everywhere:

  | Utility | Size | Line height | Tracking |
  |---|---|---|---|
  | `text-xs` | 12px | 1.35 | +0.01em |
  | `text-sm` | 14px | 1.45 | 0 |
  | `text-base` | 16px | 1.5 | 0 |
  | `text-lg` | 18px | 1.35 | -0.005em |
  | `text-xl` | 20px | 1.25 | -0.008em |
  | `text-2xl` | 24px | 1.2 | -0.011em |
  | `text-3xl` | 30px | 1.15 | -0.014em |
  | `text-display` | 40px | 1.05 | -0.02em |
  | `text-score` (new) | 76px | 0.9 | -0.035em |

  `text-micro` (11px) and `text-label` (12.5px) keep their sizes and tracking. One-offs (`text-4xl`, `text-5xl`, `text-[1.35rem]`, `tracking-[-0.03em]`, `tracking-wider`) map to the nearest step.
- Type roles never use the CSS `font:` shorthand, because it resets `font-feature-settings` and `font-variant-numeric` (found while building the mockup).
- Prose blocks are capped at `max-w-[68ch]`.

### 2. Night vision (`index.css` night block)

- `--color-ink` #ee5a4b (6.2:1 on #050000), `--color-ink-2` #d24c3f (4.8:1 on #050000, 4.5:1 on #1c0505), `--color-muted` #d24c3f. Hierarchy at night comes from weight and size.
- `--color-ice` (accent) #ff5a47. Inline text links (`a.text-ice` that are not buttons) are underlined in night vision.
- Primary text is about 25 % brighter than today. The developer confirms in a dark room; if it is too bright, the fallback is to scale both levels down together while staying at or above 4.5:1.
- A unit test parses the night block and asserts every text token is at least 4.5:1 against `--color-night`, `--color-night-deep` and `--color-panel-2`.

### 3. Tonight

- `PageHeader` subtitle: the location label plus coordinates (`Philadelphia, PA (sample) · 39.95° N, 75.17° W`). The date stays in the title and the header's night control. The time zone is dropped from the subtitle, because every time already shows its zone abbreviation.
- The sample-location notice becomes a plain line under the subtitle (`PageHeader` gains a `notice` slot) instead of a floating box on the right.
- One conditions panel: score, window line, headline and "Why this score" on the left; the night strip on the right; the four facts and the forecast source across the bottom. The strip drops its visible "forecast clear · 10 h 45 min" label (the headline says it); the clear bar stays, and its text stays for screen readers.
- Strip hint: "Hover over the strip for hourly values." on hover devices; "Tap the strip for hourly values." on touch devices (`@media (hover: none)`). Both strings exist today or are new copy; the strip already reads values on `pointerdown`.
- Target cards:
  - The add button becomes a tinted button (`btn-tinted`: accent text on an accent tint, no fill) labelled "+ Add" from `sm` up and icon-only below, keeping its `aria-label` and a 44 × 36 px minimum target.
  - The image overlay keeps only the field width ("2°"). The fit status text leaves the image.
  - Framing notes are shortened in `backend/app/scoring.py` `fit_notes` and lose the per-note "(FOV axis unverified)":
    - `Larger than the ~148′ field (178′ across): expect partial framing or a mosaic.`
    - `Fills most of the ~148′ field (120′ across).`
    - `Small in the ~148′ field: 9.3′ across.`
    - The "size unavailable" note is unchanged.
  - The caveat appears once in the targets intro when the equipment's `fov_definition` is `"unknown"`: "Field sizes assume about 148′ across; the S30's FOV axis is unverified." (built from the equipment's name and `fov_deg`). The target detail drawer already states it ("Framing notes use … (~2.46° field, axis unverified)", `TargetDetail.tsx:163-168`) and is unchanged. CLAUDE.md requirement 5 stays met on every surface that shows the notes.

### 4. Explore

- One grouped list: a single `panel` container with `divide-y divide-line-soft`; rows highlight with a background tint on hover instead of a border.
- When "Observable only" is off, targets that are not observable go into a second group headed "Not observable tonight", each with its `status_text` and detail as one plain sentence (no badge).

### 5. Star page

- Tonight, Seestar fit and Light curve become a definition list (`dl`) with no box.
- "How to read a variable star" loses its box; prose is capped at 68ch.
- Mission cards keep their card treatment, because they track progress.

### 6. Shared

- Badges: two styles only. `.badge` (neutral) and `.badge-accent` (accent tint, no border) replace every inline `border-ice/40 text-ice` variant; ScoreHero's dashed "Heuristic" badge becomes `.badge`.
- Copy: remove the three em-dashes (`CompareStep.tsx:129,144` use an en-dash placeholder like the rest of the app; `AstroLogImportPage.tsx:43` becomes a colon). En-dashes in ranges stay: the taste skill's dash ban targets decorative dashes in marketing copy, and a range dash is correct typography.

## Testing

- Vitest:
  - The night-vision contrast test (section 2).
  - `fit_notes` copy (pytest).
  - The strip hint strings.
  - `PageHeader` notice slot.
  - The tinted add button keeps its accessible name.
  - Explore splits observable and not-observable groups.
  - The badge variants.
- Playwright:
  - `body` has no `tnum` and a score element is `tabular-nums`.
  - In night vision, "Set your own location" is underlined.
  - On the mobile project, the touch hint shows and the hover hint does not.
- Full suites before each commit. Visual check of Tonight, Explore and the star page at 1440 and 390 px in normal and night vision against the mockup.

## Risks

- Removing `tracking-tight` everywhere shifts heading widths slightly; long names may wrap differently. Check cards with long names (e.g. "Little Dumbbell Nebula").
- The opsz font is 25 kB heavier.
- Night text is brighter; the dark-room check may require scaling down.
- Changing `fit_notes` text breaks any test or snapshot that matches the old strings; update them in the same task.
