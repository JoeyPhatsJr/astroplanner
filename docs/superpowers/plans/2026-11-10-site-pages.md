# Site Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/how-it-works`, `/privacy`, `/credits` and `/terms`, sharing one site header and footer with the homescreen `/`.

**Architecture:** A `SiteLayout` route element (header, `<main id="site-main">`, footer) wraps `/` and the four pages, outside the app shell. The homescreen's header and footer move out of `LandingPage.tsx` into `components/site/`. Page copy is JSX per page; numbers that must match the backend (score weights, DSS acknowledgment) are pinned by a pytest that reads the frontend files.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind v4, react-router-dom, lucide-react, Vitest + Testing Library, Playwright, pytest.

**Spec:** `docs/superpowers/specs/2026-11-10-site-pages-design.md` (approved 2026-11-10). Mockup: `docs/superpowers/mockups/2026-11-10-site-pages/index.html` (serve the repo root: `python3 -m http.server`, open that path). Read both.

## Global Constraints

- Build on `main` at or after `040c5e0` (PR #7 merged). Header and type rules come from `frontend/src/styles/landing.css` as it is now, not from the mockup's copied CSS.
- Headlines exactly: "Every number shows its work." / "Your pictures stay yours." / "Built on open science." / "Plain terms."
- Every way into Tonight is a link to `/tonight` labelled exactly `See tonight’s sky` (curly apostrophe), footer included.
- No sign-in control, account section, or "For the login design" box. No pricing, testimonials, counts or logos.
- No em dash (U+2014) or en dash (U+2013) in visible text on these pages.
- Every claim must match the spec's "Facts the pages state" table, including the two corrections (Privacy "Deleting", Terms date).
- Accessibility: one `h1` per page; skip link to `#site-main`; visible `:focus-visible`; 44 px minimum tap height on the header pill; reduced-motion, reduced-transparency and increased-contrast behaviour of `.landing-header` unchanged.
- Night vision is honoured from the saved setting; no toggle on these pages.
- Icons: lucide-react only (`Check`, `Dot` or `Circle`, `ArrowUpRight`, `X` for the four Privacy cards), `aria-hidden`.
- Commit after each task; push or merge only with the developer's approval.

## Review Focus

1. **A 320 px phone.** The site header (logo, wordmark, "See tonight’s sky") stays on one row with no horizontal scroll on every site page. Pinned in Task 5 e2e.
2. **Leaving the homescreen.** Navigating from `/` to `/privacy` must not keep the homescreen's twilight body background (`landing-sky` class and inline `background-color`). Pinned in Task 1 unit test.
3. **Opening a site page directly or reloading it.** `/credits` loaded cold renders the page, not the app shell or a 404. Pinned in Task 5 e2e.
4. **Night vision at the telescope.** Site pages render red-only body text when night vision is saved on. Pinned in Task 5 e2e.
5. **Copy drift.** If someone changes a score weight or the DSS acknowledgment in the backend, the How it works and Credits copy must fail a test. Pinned in Task 2 and Task 4 pytest.

---

### Task 1: Shared site layout

**Files:**
- Create: `frontend/src/components/site/SiteLayout.tsx`, `frontend/src/components/site/SiteHeader.tsx`, `frontend/src/components/site/SiteFooter.tsx`, `frontend/src/components/site/links.ts`
- Modify: `frontend/src/pages/LandingPage.tsx` (remove skip link, header, `<main>` wrapper and attribution paragraph; keep the photo-source note as the last element of the page), `frontend/src/App.tsx` (route `/` inside `SiteLayout`), `frontend/src/components/landing/content.ts` (move `NAV_LINKS` to `site/links.ts`)
- Test: `frontend/src/components/site/SiteLayout.test.tsx`; update `frontend/src/pages/LandingPage.test.tsx` (route set: replace `#landing-main` with `#site-main`) and `frontend/src/App.test.tsx`

**Interfaces:**
- Produces: `NAV_LINKS: {to: string; label: string}[]` (Explore, AstroLog, Variable stars, as today) and `ABOUT_LINKS: {to: string; label: string}[]` in `site/links.ts`, initially `[]`; Tasks 2 to 4 each append their entry in this order: How it works, Privacy, Credits & data, Terms. `SiteLayout()` renders `<SiteHeader/>`, `<main id="site-main"><Outlet/></main>`, `<SiteFooter/>`, wrapped in `ErrorBoundary` keyed by pathname.
- `SiteHeader` is the current `.landing-header` markup moved as is, with the pill given `min-h-11` (44 px) and a comment marking where the sign-in control goes later (render nothing).
- `SiteFooter`: blurb "Plan the night, keep the record, learn to process. Free, for personal use."; App list (See tonight’s sky → `/tonight`, then `NAV_LINKS`); About list (`ABOUT_LINKS`, then "Source on GitHub" → `https://github.com/JoeyPhatsJr/astroplanner`, `target="_blank" rel="noreferrer"`); the attribution line from today's homescreen footer plus " Scores are heuristic planning estimates."

- [ ] **Step 1: Write failing tests** in `SiteLayout.test.tsx` (render `App` at a path, as `App.test.tsx` does):
  - `renders the site header and footer around the homescreen, outside the app shell`: at `/`, `getByRole("navigation", {name: "Site"})` exists, `queryByRole("navigation", {name: "Primary"})` is null, `getByRole("contentinfo")` contains a link "Source on GitHub" with that href.
  - `skip link targets the main landmark`: link "Skip to content" has `href="#site-main"` and `document.getElementById("site-main")` is the `main` element.
  - `leaving the homescreen clears its page sky`: render `App` at `/`, assert `document.body` has class `landing-sky`, click the header link "Explore" (a router link to `/explore`, which leaves `SiteLayout`), then assert `document.body` lacks class `landing-sky` and `document.body.style.backgroundColor === ""`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/components/site` . Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the four files and the `LandingPage` / `App` / `content.ts` changes. `/` becomes `<Route element={<SiteLayout/>}><Route path="/" element={<LandingPage/>}/></Route>`.
- [ ] **Step 4: Run** `cd frontend && npx tsc -b --noEmit && npx vitest run`. Expected: all pass (existing landing and App tests updated as listed).
- [ ] **Step 5: Run** `cd frontend && E2E_API_PORT=8130 E2E_WEB_PORT=5210 npx playwright test e2e/landing.spec.ts`. Expected: all pass, unchanged behaviour.
- [ ] **Step 6: Commit** `feat(site): shared site layout for the homescreen and site pages`.

### Task 2: How it works page, with weights pinned to the backend

**Files:**
- Create: `frontend/src/pages/site/HowItWorksPage.tsx`, `frontend/src/components/site/scoreWeights.json`, `frontend/src/components/site/SitePageIntro.tsx`, `backend/tests/test_site_copy.py`
- Modify: `frontend/src/App.tsx` (route `/how-it-works` in `SiteLayout`), `frontend/src/components/site/links.ts` (append `{to: "/how-it-works", label: "How it works"}`)
- Test: `frontend/src/pages/site/sitePages.test.tsx`

**Interfaces:**
- Produces: `SitePageIntro({eyebrow, title, lede, meta?}: {eyebrow: string; title: string; lede: string; meta?: string})`, rendering eyebrow `<p class="landing-eyebrow">`, `<h1 class="landing-h1">`, `<p class="landing-lede">`, optional `<p>` meta; left-aligned, max width as in the mockup. Used by Tasks 3 and 4.
- `scoreWeights.json`: `{"tonight": {"cloud": 45, "precipitation": 25, "moon": 20, "darkness": 10}, "target": {"altitude": 30, "duration": 25, "weather": 25, "moon": 20}}`. The page reads the points from it.

- [ ] **Step 1: Write failing tests.**
  - pytest `test_site_copy.py::test_score_weights_json_matches_scoring`: load `frontend/src/components/site/scoreWeights.json` (path from repo root) and assert it equals `{k: int(v) for k, v in TONIGHT_WEIGHTS.items()}` and the same for `TARGET_WEIGHTS`.
  - vitest `sitePages.test.tsx::how it works states its working`: at `/how-it-works`, h1 text "Every number shows its work."; the Tonight table lists Cloud cover 45, Rain risk 25, Moonlight 20, Darkness available 10 with badges Forecast, Forecast, Calculated, Calculated; text "No forecast, no total." present; text "out of 75" present; no text node contains U+2014 or U+2013.
- [ ] **Step 2: Run** both. Expected: FAIL.
- [ ] **Step 3: Implement** the page with the mockup's four sections (The sky, for your spot / Tonight’s Score / Ranking targets / What it won’t claim), its in-page chips as `#` anchors with `scroll-mt` covering the header, the score bar (segments only, no track), and the "Full formulas" line linking to the docs on GitHub. Write "0 to 100", never a dash range.
- [ ] **Step 4: Run** `cd backend && .venv/bin/python -m pytest -q tests/test_site_copy.py` and `cd frontend && npx vitest run src/pages/site`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(site): How it works page, weights pinned to scoring`.

### Task 3: Privacy and Terms pages

**Files:**
- Create: `frontend/src/pages/site/PrivacyPage.tsx`, `frontend/src/pages/site/TermsPage.tsx`
- Modify: `frontend/src/App.tsx` (routes `/privacy`, `/terms`), `frontend/src/components/site/links.ts` (append Privacy, then Terms; Task 4 inserts Credits between them, giving the final order How it works, Privacy, Credits & data, Terms)
- Test: `frontend/src/pages/site/sitePages.test.tsx`

**Interfaces:**
- Consumes: `SitePageIntro` (Task 2).

- [ ] **Step 1: Write failing tests.**
  - `privacy says what is kept and how to delete it`: h1 "Your pictures stay yours."; four card headings "Never leaves your computer", "What it keeps", "Sent to other services", "Not in AstroPlanner"; text contains "saved preferences in your browser" and "clearing this site's data in your browser" (the spec's corrected Deleting copy, verbatim); `queryByText(/For the login design/)` is null; "Updated 10 Nov 2026" present.
  - `terms is a dated draft`: h1 "Plain terms."; "Updated 10 Nov 2026" present; draft label text "Draft: plain-language summary, not legal advice. Review before a public launch." present.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/pages/site`. Expected: FAIL.
- [ ] **Step 3: Implement** both pages from the mockup copy with the spec's corrections. Privacy cards: 2 × 2 grid from `md`, one column below; lucide icons `Check` (Never leaves), `Circle` small (What it keeps), `ArrowUpRight` (Sent), `X` (Not in), each `aria-hidden`. Deleting paragraph exactly as in the spec, plus the `DATABASE_URL` clause: "(If you point AstroPlanner at your own database with DATABASE_URL, it lives there instead.)"
- [ ] **Step 4: Run** `cd frontend && npx tsc -b --noEmit && npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(site): Privacy and Terms pages`.

### Task 4: Credits page, DSS acknowledgment pinned

**Files:**
- Create: `frontend/src/pages/site/CreditsPage.tsx`
- Modify: `frontend/src/App.tsx` (route `/credits`), `frontend/src/components/site/links.ts` (insert "Credits & data" before Terms), `backend/tests/test_site_copy.py`
- Test: `frontend/src/pages/site/sitePages.test.tsx`

**Interfaces:**
- Consumes: `SitePageIntro` (Task 2); `DSS_ACKNOWLEDGMENT` from `backend/app` (wherever `api.py` imports it from).

- [ ] **Step 1: Write failing tests.**
  - pytest `test_dss_acknowledgment_is_quoted_on_credits`: read `frontend/src/pages/site/CreditsPage.tsx` as text; assert `DSS_ACKNOWLEDGMENT` (whitespace-normalised) appears in it (whitespace-normalised).
  - vitest `credits lists every source with its license`: h1 "Built on open science."; headings or names OpenNGC, Open-Meteo, Digitized Sky Survey (STScI), AAVSO VSX, Astropy, photutils, timezonefinder, Siril, ZWO Seestar S30; texts "CC BY-SA 4.0", "BSD-3-Clause", "GPL-3.0"; every external link has `rel="noreferrer"`.
- [ ] **Step 2: Run** both. Expected: FAIL.
- [ ] **Step 3: Implement** the page: Data, Software, Equipment groups as in the mockup (each entry: name, license, one line, link), the VSX attribution sentence verbatim from the README, and the full DSS acknowledgment.
- [ ] **Step 4: Run** pytest file and `npx vitest run src/pages/site`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(site): Credits & data page, DSS acknowledgment pinned`.

### Task 5: Links from the app, end-to-end checks, docs

**Files:**
- Modify: `frontend/src/components/layout/AppShell.tsx` (`FooterText`: append " How it works · Privacy" as router links to `/how-it-works` and `/privacy`), `frontend/src/pages/LandingPage.test.tsx` (real-route set adds the four paths), `README.md` (short "Site pages" paragraph under "Homescreen"), `PROGRESS.md`, `ROADMAP.md` (decision row)
- Create: `frontend/e2e/site.spec.ts`

- [ ] **Step 1: Write the e2e spec** `site.spec.ts`, for each of `/how-it-works`, `/privacy`, `/credits`, `/terms` loaded directly with `page.goto`:
  - h1 visible with the exact headline; `getByRole("navigation", {name: "Primary"})` has count 0; no console or page errors.
  - at 320 × 700 and 390 × 844: `document.documentElement.scrollWidth - innerWidth <= 0`, and the header link "See tonight’s sky" has a bounding box fully inside the viewport and height ≥ 44.
  - night vision: set `astroplanner.prefs.v1` `nightVision: true` (as `landing.spec.ts` does), reload `/privacy`, assert `html[data-vision="night"]` and body text colour red-dominant (r > 150, g < 90, b < 90).
  - from `/` click footer link "Privacy" and land on `/privacy`; from `/settings` click shell footer link "How it works" (desktop project only, the shell footer is `md:block`).
- [ ] **Step 2: Run** `cd frontend && E2E_API_PORT=8130 E2E_WEB_PORT=5210 npx playwright test e2e/site.spec.ts`. Expected: FAIL on the shell link until Step 3.
- [ ] **Step 3: Implement** the `FooterText` links and the `LandingPage.test.tsx` route set.
- [ ] **Step 4: Run the full suites:** `cd backend && .venv/bin/python -m pytest -q`; `cd frontend && npx tsc -b --noEmit && npx vitest run && npm run build`; `cd frontend && E2E_API_PORT=8130 E2E_WEB_PORT=5210 npx playwright test`. Expected: all pass.
- [ ] **Step 5: Browser check** at 1440, 390 and 320 px and with night vision on, all four pages; compare against the mockup. Fix anything off.
- [ ] **Step 6: Update docs** (README paragraph, PROGRESS milestone row with the commands and counts actually run, ROADMAP decision row) and **commit** `feat(site): app links to site pages, e2e and docs`.
