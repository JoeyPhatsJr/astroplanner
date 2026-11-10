# AstroPlanner polish pass: design

_Date: 2026-11-09 · Status: approved by the developer 2026-11-09 · Replaces Phase 5 as the next piece of work; photometry stays planned._

Prototype (real forecast data, three kinds of night, normal and night vision, desktop and phone):
`docs/superpowers/mockups/2026-11-09-polish/tonight.html`. That repository copy has the survey images removed, because the repository is
public (§2); the version with images stays in the git-ignored `.superpowers/` folder.

## 1. Why

A whole-app audit (2026-11-09) found the app correct and honest but unfinished in feel: three transitions in the entire
frontend and no press states, a Tonight headline that says 100/100 on a night that goes overcast, text-only target cards,
a phone layout that is a shrunken desktop, and pages that do not line up with each other.

**What success looks like:** it feels responsive under the finger, Tonight tells the truth at a glance, it looks like an
astrophotography tool, it works one-handed at a telescope in the dark, and every existing accuracy rule still holds.

## 2. Scope

**Goals:** shared foundations (type, widths, motion), a redesigned Tonight, sky images on targets, purposeful motion, a
native-feeling phone experience, night vision with no non-red leaks, and consistency across the other screens.

**Non-goals:** new product features, photometry, deployment, changing how any score is calculated.

**Anti-goals (a failure even if it works):**
- A score, time or sky claim that is less honest or more precise than the data supports.
- Motion the user has to wait through on a screen they open every night.
- Non-red light reaching the screen in night vision.
- Sky images committed to the public repository.

## 3. Decisions

**Made by the developer:** Tonight direction B ("Score first"). Sky images on target cards.

**Claude's calls (please check these):**
- Sky images come from DSS red plates, fetched once per target and cached locally (§6).
- The framing diagram stays: it is the fallback when an image is unavailable, and it sits next to the image in the drawer,
  because a sky image cropped to the object cannot show how the object fits the S30's field.
- The target grid is two columns at every width, not the prototype's three. Below xl the Session plan panel stacks
  under the grid, but the content area is then only about 740 to 990 px, and three cards with a 112 px picture would
  leave about 115 px for text. Beside the panel on wide screens the grid is two columns as well. The prototype left that
  panel out.
- No new motion or sheet dependency (§7). Vaul is ruled out: its README says it is unmaintained.
- Headline clear times round to the half hour because the forecast is hourly. Exact runs stay on the strip.

## 4. Foundations

Added to the theme in `frontend/src/index.css`, extending what is there rather than forking it.

| Token | Value |
|---|---|
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` |
| Press / small / overlay in / overlay out | 120 ms / 180 ms / 280 ms / 200 ms |

- **Page widths:** two only, `wide` (1120 px: Tonight, Explore, Library, Coach, Star) and `reading` (860 px: Settings, Import,
  Nights). A shared `PageHeader` component replaces about nine ways of writing a page title.
- **Type:** a named scale replaces the ad hoc `text-[…]` sizes. Tracking tightens as size grows; numbers stay tabular. Nothing under 11 px.
- **Badges:** "Forecast" and "Heuristic" get different styles (`States.tsx:59` makes them identical today).
- Page title reads "Tonight" only for tonight. Other dates show the date.

## 5. Tonight

**Score panel:** the number stays large, always followed by what it covers ("for the best 2 hours, 18:25–20:25", Heuristic).
Under it, in plain words, the whole night: "Clear until about 01:30. 7 h 10 min of 10 h 45 min of darkness is forecast clear."
"Why this score" is a disclosure holding the existing breakdown, so every factor stays one tap away (CLAUDE.md rule 4).

**Night strip** replaces the Recharts `NightTimeline`: one custom SVG from sunset to sunrise.
- One block per forecast hour; opacity follows cloud cover. No smoothing, because the data is hourly.
- Twilight gradient behind, a bar for the forecast-clear run, a marker for the best 2 hours, a thin band while the Moon is up.
- Hover or tap a block for exact cloud and rain values. Source, retrieval time and model-data note stay directly under it.
- Separate narrow rendering on phones, so labels stay readable.

**Facts row:** cloud average, rain peak, Moon, darkness, replacing the four separate tiles.

**Target cards:** sky image with its width marked, name, score, time window, clear time ("4 h 58 m clear of 5 h 01 m up"),
sparkline, framing note and a 44 px add button. The whole card opens details. Removed: "Peak in darkness" and bullet lines
that repeat across cards. A fact shared by every card moves to one line above the grid, and only when it really is shared.

**States, each shown in the prototype or specified here:**

| State | Behaviour |
|---|---|
| Normal forecast | As above |
| No clear darkness | "No forecast-clear darkness", no clear bar |
| Beyond forecast range, or forecast failed | "No score" with calculated parts only, as today; strip shows darkness and Moon with "No forecast this far ahead"; provider message shown; nothing invented |
| Partial forecast | Existing partial notice stays; missing hours are empty, never drawn as clear |
| No darkness (high latitude) | Existing notice and nautical switch; strip without a clear bar |
| Sample location | Existing notice stays |

**Backend:** `/api/tonight` gains `night_clear` (`start_utc`, `end_utc`, `minutes`, `rule`, or null), using the existing
`FAVORABLE_CLOUD_PCT` / `FAVORABLE_PRECIP_PCT` constants and nearest-hour series, longest run in darkness. Card clear time uses
the existing `score.forecast_window`. All astronomy stays on the backend. No score changes.

## 6. Sky images

**Terms (read 2026-11-09):** MAST's data use policy lists DSS as a copyrighted collection, free for "research, teaching
(including textbooks), or other non-profit activities"; commercial use needs permission. Acknowledgment is requested. Colour
DSS needs a separate request, so red plates only. Caching and redistribution are not addressed. CDS hips2fits terms could not be
read and it is not used.

**Delivery:**
- `GET /api/targets/{id}/sky-image` returns a JPEG. A provider is injected through `app.state`, like weather, so tests never touch the network.
- Upstream: STScI `dss_search`, `poss2ukstu_red`. Width = `clamp(1.5 × catalog major axis, 40′, 120′)`; 120′ is the service's limit.
- Downscaled with Pillow (already a dependency) to about 480 px and stored in `backend/data/sky-images/`, **git-ignored**.
- One upstream request at a time, at least 1 s apart, 60 s timeout, and a failed target is not retried for an hour.
  A 120′ request is about 40 MB and 14 s, so each target is fetched once, only when first shown. No bulk prefetch.
- A generic client name, with no personal contact details.
- `ASTROPLANNER_SKY_IMAGES=off` disables it.

**Frontend:** card shows the framing diagram until the image arrives, then crossfades. On failure the diagram simply stays.
Tonight cards and the target drawer only; Explore's 58 rows stay text.

**Credit:** a line under the grid, and in Settings → Data sources with STScI's full acknowledgment text.

**Data caveats:**
- Survey plates can have bright edges (visible on M31 in the prototype). The server trims saturated edge rows and columns; if too much is lost it treats the image as unavailable.
- OpenNGC sizes are not always the object people mean (IC 1396 lists 14′ for a nebula far larger), so a small curated override list sets a width where needed.
- Images are decades-old plates, labelled as survey images, never as what the S30 will capture.

**Public deployment prerequisite** (added to `ROADMAP.md`): re-check DSS terms with STScI, including caching, before going public, or switch this off.

## 7. Motion

Standard: Emil Kowalski's and Apple's guidance as packaged in the installed skills. CSS and direct style writes only. Transform and opacity only, except the disclosure.

**Opportunities (find-animation-opportunities), by leverage:**

| # | Location | Today | Purpose | Frequency | Motion |
|---|---|---|---|---|---|
| 1 | `index.css:135` `.btn`, cards, chips | No press state | Feedback | Tens/day | `:active { scale(0.97) }`, 120 ms `--ease-out` |
| 2 | `TargetDetail.tsx:39` | Snaps open | Spatial consistency | Occasional | Slide from right (phone: bottom), 280 ms `--ease-drawer`; exit same path 200 ms |
| 3 | `ConfirmDialog.tsx:60` | Snaps open | Preventing a jarring change | Occasional | `opacity 0, scale(0.96)` to settled, 180 ms `--ease-out`, centred; exit 120 ms |
| 4 | `ScoreHero.tsx:114`, `AstroLogImportPage.tsx:575` | Disclosure snaps | State indication | Occasional | `::details-content` height and opacity 200 ms; chevron rotates 180 ms; instant where unsupported |
| 5 | Target card image | n/a | Preventing a jarring change | Once per target | Opacity 0 to 1, 200 ms |
| 6 | `lib/vision.ts` night-vision switch | Instant full-screen colour change | Preventing a jarring change | Occasional | View Transition crossfade 200 ms only when leaving night vision (red to normal), where it softens the brightness jump; switching into night vision is always instant because a crossfade would show non-red pixels, which the night-vision rule forbids; instant where unsupported or motion is reduced |

**Rejected:**
- Route changes: core navigation, tens of times a day. Replace the "Loading…" flash (`App.tsx:27`) with a page-shaped skeleton shown only after 200 ms.
- Staggering the target grid: landing page, seen every night.
- Chart line drawing: data being read.
- Night stepper: frequent, and the content is data.
- Sidebar collapse: would animate width.

**Choreography:** on load everything appears together with a 150 ms opacity change and no movement. Drawer and scrim share one start and one curve; drawer contents are simply there. Exits are simultaneous.

**Reduced motion:** movement removed, opacity kept. `index.css:210` no longer blanks all transitions.

## 8. Phone

- **Sheet:** target details become a bottom sheet (88 % height) on narrow screens, built on the existing native `<dialog>` so focus trapping and Esc stay free.
  Exit is controlled with `data-closing`, then `close()` after the transition, which works in every browser.
- **Gesture:** drag from the sheet's top only; the body scrolls normally with `overscroll-behavior: contain`. 1:1 transform writes, no React state during drag. Rubber-band upward.
  Dismiss past 35 % of height or above 0.5 px/ms. Scrim opacity follows drag progress. A closing sheet can be caught. Interactive children do not start a drag.
- **Header:** one row (location and scope chip, night stepper) replacing 181 px of stacked controls.
- **Platform fixes:** `viewport-fit=cover` with safe-area padding on the bottom nav and sheets; tap highlight off with `:active` everywhere; `touch-action: manipulation` on controls;
  16 px inputs on coarse pointers; no text selection on controls; `.btn:hover` limited to `(hover: hover) and (pointer: fine)`; 44 px targets; touch-aware chart hints; translucent nav with a `prefers-reduced-transparency` fallback.

## 9. Night vision

- Replace the `.vision-img` filter (`index.css:115`). In the prototype it turned bright image areas yellow-green. An SVG colour matrix sends brightness only to the red channel.
- Header and filter selects and the date picker become themed controls, because native popups are drawn by the OS. Choice of primitive: run `/pick-ui-library` at that milestone.
- Raise `--color-muted` from 2.43:1 (`#a23a30` in the prototype), to be judged in a dark room.

## 10. Other screens

Foundations and shared motion apply everywhere. Specific work: Library and Target pages get the same card and image treatment; Star page's stacked panels are consolidated and
"Planned for a later phase" removed; Coach report's chart card stops stretching; Import and Settings adopt the reading width.

## 11. Validation

- **pytest:** `night_clear` (all clear, none, partial, gaps, no forecast, no darkness); sky provider with no network (hit, miss, failure back-off, one at a time, width rule, edge trimming, switch off).
- **Vitest:** headline wording and rounding, strip states, image fallback, sheet open and close, drag threshold as a pure function.
- **Playwright:** existing suites stay green, with the sky route stubbed; new checks for drawer, sheet and states. Earlier-phase assertions change only where visible text deliberately changed, each listed.
- **Skills:** `review-animations` on the final diff (developer runs it), `break-ui` on Tonight cards and Library, `animation-performance` on the sheet and scrim.
- **By hand:** a real phone, and night vision in a dark room. Emulation cannot confirm safe areas, input zoom or gesture feel. Testing on a phone needs the dev server opened to the home network, which is the developer's call at that point.

## 12. Risks

| Risk | Handling |
|---|---|
| DSS terms for public use unclear | Local only for now, switch-off flag, roadmap prerequisite |
| STScI slow or down | Framing diagram fallback, back-off, one request at a time |
| Hand-built gesture feels wrong | Tested on real hardware; limited to the sheet top |
| `::details-content` and View Transitions not universal | Both degrade to instant |
| Scope spreads across all screens | Milestones are independently shippable; stop after any of them |

## 13. Milestones

Each ends with passing tests and a commit.

1. Foundations and press states
2. Tonight: `night_clear`, score panel, night strip, states
3. Sky images: backend, cards, fallback, credit
4. Overlays: drawer, confirm dialog, disclosures, skeletons
5. Phone: sheet gesture, header, platform fixes
6. Night vision: image filter, themed controls, contrast
7. Remaining screens
8. Validate, docs, review, merge, tag `polish-1`
