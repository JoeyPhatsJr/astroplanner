# Landing page — implementation plan

Spec: `docs/superpowers/specs/2026-11-09-landing-page-design.md`. Each milestone ends with typecheck + Vitest
green and a commit.

## M1 · Routes: Tonight moves to `/tonight`, landing at `/`
- `App.tsx`: `/` renders `LandingPage` outside the shell; all other routes nest in a layout route that wraps
  `AppShell` + `ErrorBoundary` + `Suspense` around an `<Outlet/>`.
- `AppShell.tsx`: nav "Tonight" → `/tonight`; wordmark (sidebar and mobile header) links to `/`.
- Update `/` links: 404 page, `AstroLogPage` (empty state + "Open night of…"). Grep for any others.
- e2e: `goto("/")` → `goto("/tonight")` where Tonight is meant.
- Test (Vitest): `/` renders the landing `h1` with no sidebar; `/tonight` link target from the landing CTA.

## M2 · Landing page: header, hero photo, story chapters, gallery, footer
- `frontend/public/landing/`: m31 (1920w, 960w), eagle, veil, dumbbell, ngc7000 (900w), five screenshots
  (JPEG, 1440w).
- `pages/LandingPage.tsx` + `components/landing/*` (`LandingNav`, `StoryChapters`, `Gallery`).
- `styles/landing.css`: entrance keyframes, chapter reveal, sticky clock; all off under reduced motion.
- `useChapterProgress` hook: IntersectionObserver (guarded when unavailable) → active chapter; sets the
  page sky on `<body>` via theme tokens and restores it on unmount.
- Tests: chapter content, every link resolves to a real route, alt text present, example label present.

## M3 · City box
- `components/landing/CitySearch.tsx`: labelled input → `api.geocode` → result list → choose →
  reuse-or-create location → `update({ locationId, nightDate: null })` → navigate `/tonight`.
- Pure helper `findMatchingLocation(list, result)` (≤ ~1 km) with unit tests.
- Timezone fallback: `api.timezoneAt`; if null → navigate to `/settings` with `prefillLocation`.
- Tests: loading, empty, geocode error, reuse existing, create new, timezone fallback, settings fallback.

## M4 · Verify and document
- Playwright: landing smoke (headline, photo, CTA → Tonight, no console errors), city box against the real
  backend if geocoding is reachable (skip with a reason otherwise).
- Run typecheck, build, Vitest, pytest, Playwright. Browser check: 1440, 390, night vision.
- README (landing + `/tonight`), PROGRESS (milestone, limitations, exact next step), ROADMAP, new screenshots.

## Risks
- Polish-pass worktree also edits Tonight; merging later may conflict in `App.tsx`/`AppShell.tsx` route paths.
  Keep those diffs small.
- Geocoding is an external API; tests mock it, e2e tolerates it being unreachable.
