# Landing page (homescreen) — design

**Date:** 2026-11-09 · **Branch:** `worktree-landing-page` · **Status:** approved mockup (B v2), building

## Intent

Someone interested in astrophotography, beginner or experienced, opens AstroPlanner and is first told the
story and shown what the app is, before they touch any tool. The feeling to land, in the developer's words:
*"they needed this and didn't even know, and it will make it easy."* The reference is the OpenAI homepage
pattern: a large, quiet headline first, then the product and real results shown big, little chrome.

Today `/` drops straight into the Tonight dashboard with no introduction.

## Approved design (mockup "B v2")

Mockups: `.superpowers/brainstorm/…/content/landing-b-v2.html` (local, git-ignored).

1. **Header first.** Eyebrow "Astrophotography, made easy"; headline "One night. One picture. / Everything in
   between."; one line of lede; two buttons: **See tonight's sky** (→ Tonight) and **Follow one night ↓**
   (scrolls to the story). Light nav bar: wordmark, Tonight / Explore / AstroLog / Variable stars,
   **Open the app**.
2. **Then the picture.** The developer's own Andromeda Galaxy (M31, with M32 and M110), a wide 16:9 band under
   the header that fades in just after the text. (Explicit instruction: do not open with the picture.)
3. **One night, scrolled.** Five chapters, each a real app screenshot. A sticky clock advances
   16:57 Sunset → 18:28 Astronomical darkness → 06:32 Sunrise → Later (at your desk) → Next (your next clear
   night), and the page sky darkens as you scroll. The times come from the saved example night
   (Philadelphia, 2 Nov) that the screenshots show.
   Tonight → Explore detail → AstroLog → Processing coach → Variable Hunter.
4. **Gallery, "What one night can look like."** The developer's Eagle (M16), Eastern Veil (NGC 6992),
   Dumbbell (M27) and North America Nebula (NGC 7000) captures.
5. **Close, "Clear skies tonight?"** A city box that actually works (below), then source attribution.

## Constraints (from CLAUDE.md / spec)

- **No dummy data presented as live.** Every number on the page is from a saved example night and is labelled
  "Example …". The landing page shows no live forecast or score.
- **Accurate copy only.** Every claim maps to shipped behaviour (Phases 1–4). Nothing about photometry,
  AAVSO observations, or features not built. Variable Hunter is described as four curated stars with
  tonight's window and AAVSO links, which is what it does.
- **Attribution** (OpenNGC, Open-Meteo, Astropy) stays in the footer.
- **Photo captions name the object only.** No telescope, exposure or date is stated for the developer's photos
  until the developer supplies them; inventing them would be fabricated data.
- **Accessibility:** one `h1`, labelled input, real links/buttons (no dead buttons: every nav item and CTA
  goes somewhere real), alt text on photos, decorative screenshots described, keyboard focus visible.
- **Motion** is entrance-only and scroll-linked, `ease-out`, and fully disabled under
  `prefers-reduced-motion`. No looping or twinkling (the app's starfield is static on purpose).
- **Night vision** keeps working: colours come from theme tokens, photos and screenshots get the existing
  `.vision-img` red filter.
- **Responsive** at 390 px with no horizontal scroll; headline wraps; clock becomes a sticky strip.

## Decisions made while building (my call; the developer was away)

- **Routes.** `/` is the landing page and is always shown (like the reference homepage). Tonight moves to
  `/tonight`. The landing page renders **outside** the app shell (no sidebar, header controls or bottom tab
  bar); every other route keeps the shell. The shell's wordmark links back to `/`. All internal links that
  meant "Tonight" (`/`) move to `/tonight`, including the 404 page, AstroLog's "Plan tonight" and
  "Open night of …", and the shell nav. Old `/` bookmarks now land on the homescreen, one click from Tonight.
- **City box.** Typing a city searches the existing `/api/geocode` (Open-Meteo Geocoding). Choosing a result
  reuses a saved location at the same place (within about 1 km), otherwise saves it as a new location
  (`POST /api/locations`), makes it current and opens `/tonight`. If the result has no timezone, it is looked up
  from coordinates (`/api/timezone`); if that also fails, the developer is sent to Settings with the place
  prefilled rather than guessing a timezone. Loading, no-results and error states are shown in place.
- **Assets** live in `frontend/public/landing/`: resized JPEGs of the five photos (hero at 1920 and 960 wide)
  and JPEG copies of the five existing `docs/screenshots` app screens. Screenshots will go stale if the
  in-progress polish pass changes those screens; re-shooting them is a documented follow-up.
- **Bundling.** Landing and Tonight both stay in the main bundle: landing is the first page, Tonight is its
  main call to action.

## Non-goals

- No marketing analytics, sign-up, pricing, testimonials or newsletter.
- No live data on the landing page (live data lives on Tonight).
- No change to Tonight's own design (the separate polish pass owns that).
- No deployment (local-only until near completion).

## Done when

- `/` shows the landing page; `/tonight` shows Tonight; every in-app "Tonight" link works.
- City box works end-to-end against the real backend, with loading, empty and error states.
- Vitest covers rendering, links, the city flow (reuse vs create, timezone fallback, errors).
- Playwright smoke covers the landing page and is updated for `/tonight`.
- Typecheck, build, Vitest, pytest and Playwright run and pass; checked in the browser at desktop, 390 px and
  night vision. README, PROGRESS and ROADMAP updated.
