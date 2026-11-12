# PROGRESS

_Last updated: 2026-11-12 · Phase plan and process: see [ROADMAP.md](ROADMAP.md)_

## Current work: accounts and sign-in (branch `login-design`, awaiting developer review)

Spec: `docs/superpowers/specs/2026-11-11-accounts-design.md` (amended to match what shipped); plan:
`docs/superpowers/plans/2026-11-11-accounts.md`; mockup: `docs/superpowers/mockups/2026-11-11-login/index.html`.

| Area | What changed |
|---|---|
| Backend accounts | `backend/app/accounts/`: `users` and `user_sessions` tables (migration 0006), Argon2id hashes, 30-day sessions in an HttpOnly `SameSite=Lax` cookie (only the token's SHA-256 is stored), in-memory throttle, `X-Requested-With` guard on state-changing `/api/` requests, `/api/auth/*` routes, `python -m app.accounts reset-password` |
| Ownership | Migration 0007 adds `owner_id` to plans, nights, AstroLog and coach tables and makes dedup keys unique per owner (SQLite tables rebuilt without firing `ON DELETE`). Every owned route answers 401 signed out and 404 for someone else's row; the first account created takes over the rows that existed before, once |
| Delete account | Removes the user, their sessions, owned rows and preview files, in dependency order; nothing shared or another user's is touched |
| Frontend | Sign in, Create account and reset help pages; the header account slot (Sign in, or the initial with AstroLog, Account and Sign out); the AstroLog gate; "Sign in to plan" on Tonight and star pages; personal badges and progress only when signed in; a 401 mid-session shows the signed-out screen |
| Account page | `/account`: email and created date, the first-account claim notice, change password, sign out, delete account (password plus typed DELETE, `role="alertdialog"`); signed out it goes to sign in and back |
| Privacy | "What it keeps" starts with "Your account: your email and a password hash"; a new "Your account" section says what an account stores and what deleting it removes; Updated 11 Nov 2026 |
| Final review fixes | The AstroLog import's stashed files are dropped on any sign-in, sign-out or 401, so they never cross accounts in one tab; a failed account check (backend down) shows "Couldn’t check your account" with Try again instead of "Sign in", and on star pages and Explore's target sheet the disabled Add says "Couldn’t check your account." beside it, with a Try again that keeps focus while it asks and hands focus to Add or "Sign in to add" when it answers; deleting a place or equipment in use no longer reports other accounts' plan counts; reset help says how to clear a sign-in lockout |
| Tests | Backend accounts, ownership, migration and deletion tests; `auth.test.tsx`, `gates.test.tsx`, `account.test.tsx`, site pages; `frontend/e2e/accounts.spec.ts` (create, sign out, gate, sign in, return-to, generic wrong-password message, token only in an HttpOnly cookie, two users' isolation, delete account, nothing owned requested signed out, forgot password, header at 320 px, night vision on sign in) |

### Commands last run (2026-11-12, after the Add-button account-check fix; all passing)

```bash
cd backend && .venv/bin/python -m pytest -q            # 512 passed, 12 skipped (last run after the final review fixes)
cd frontend && npx tsc -b --noEmit                     # clean
cd frontend && npx vitest run                          # 395 passed (37 files)
cd frontend && npm run build                           # built
cd frontend && E2E_API_PORT=8130 E2E_WEB_PORT=5210 npx playwright test   # 83 passed, 5 skipped (desktop + mobile; last full run after the final review fixes)
cd frontend && E2E_API_PORT=8130 E2E_WEB_PORT=5210 npx playwright test e2e/variables.spec.ts e2e/smoke.spec.ts e2e/accounts.spec.ts   # 48 passed, 4 skipped (after the Add-button fix)
```

Design-skills check of the Account page, the change-password form, the delete dialog and the Privacy section: live
browser pass at 1440, 390, 360 and 320 px, night vision on and off, plus emulated reduced motion and increased
contrast (reduced transparency was not emulated). It fixed focus dropping to the page when "Change password" opens
(Current password is focused), mixed label layouts on phones (every row stacks below 640 px), a dialog without
overscroll containment, the email without `translate="no"` and a faint dialog edge under increased contrast; dialog
buttons measured 44 px tall and stack full width below 380 px.

### Known limitations (accounts)

- Saved places and equipment stay shared and editable by anyone using the app. A night's computed times and the
  coach's altitude numbers come from its place, so editing a place changes them. Revisit before deployment.
- Sign-in lockout is per email (5 failures in 15 minutes): someone on the same machine can delay one person's sign-in
  by 15 minutes. Supabase Auth replaces it at deployment.
- The throttle is in memory, so it resets when the backend restarts.
- The session cookie is `Secure` only when served over HTTPS; local http://127.0.0.1 does not need it.
- No email password reset: a password is reset from the terminal (`python -m app.accounts reset-password`).
- Cross-origin `VITE_API_BASE` mode is not supported with accounts; the dev proxy, e2e and single-process mode are
  same-origin.
- The Postgres branch of the 0006 and 0007 migrations was never run (no Postgres was available; `TEST_POSTGRES_URL`
  unset). It is portable by inspection; CI runs it when the variable is set.
- The explicit `BEGIN` that makes the 0007 upgrade one transaction (`run_migrations` in `backend/app/db.py`) is
  SQLite-only SQL, deliberately, inside the dialect guard with the `PRAGMA foreign_keys` switch; Postgres never runs
  it.
- Downgrading 0007 keeps the `accounts_claimed` marker in `app_meta`, so the first-account claim never runs twice;
  after a downgrade and upgrade, ownerless rows need a one-line manual claim.

### Exact next step (accounts)

Ask the developer to review the accounts branch (`login-design`) and whether to merge it (PR to `main`).
Deployment with Supabase Auth comes later (ROADMAP "Deployment").

## Previous work: site pages (branch `site-pages-design`, merged as PR #8, merge commit 09d51e4)

Spec: `docs/superpowers/specs/2026-11-10-site-pages-design.md`; plan: `docs/superpowers/plans/2026-11-10-site-pages.md`.

| Area | What changed |
|---|---|
| Layout | Shared site header and footer (`frontend/src/components/site/`), also used by the homescreen; the wordmark folds to the mark below 360 px; the header pill is at least 44 px tall |
| Pages | `/how-it-works` ("Every number shows its work."), `/privacy` ("Your pictures stay yours."), `/credits` ("Built on open science."), `/terms` ("Plain terms."); all outside the app shell |
| Links | The app shell footer links to How it works and Privacy; the homescreen footer links to all four |
| Tests | `sitePages.test.tsx`, `SiteLayout.test.tsx`, `backend/tests/test_site_copy.py` (copy pinned to the scoring weights), `frontend/e2e/site.spec.ts` (headlines, no app nav, no overflow at 320 and 390 px, tappable header link, night vision, footer links) |

### Commands last run (2026-11-10)

```bash
cd backend && .venv/bin/python -m pytest -q   # 461 passed, 12 skipped
cd frontend && npx tsc -b --noEmit            # clean
cd frontend && npx vitest run                 # 339 passed (34 files)
cd frontend && npm run build                  # built
cd frontend && E2E_API_PORT=8130 E2E_WEB_PORT=5210 npx playwright test   # 64 passed, 4 skipped (desktop + mobile)
```

### Known limitations (site pages)

- Terms is a draft written in plain language, not legal advice.
- Privacy describes the local app only. (Its account section was added with accounts, 2026-11-11.)
- Browser check done 2026-11-10 by the controller at 1440 and 320 px, with night vision. Two cosmetic differences from the mockup remain: no logo in the footer brand column, and the "What it won’t claim" list is indented more.
- Final review fix pass: scroll resets on page change, link and label rules now run over the whole app, Privacy lists everything the database keeps, per-page tab titles.

### Next step

Developer reviews the site pages, then PR and merge. (The login design followed: see "accounts and sign-in" above.)

## Current work: polish pass 2 (branch `worktree-polish-pass-2`, merged as PR #7)

Design approved 2026-11-10. Spec: `docs/superpowers/specs/2026-11-10-polish-pass-2-design.md`; plan:
`docs/superpowers/plans/2026-11-10-polish-pass-2.md`; mockup: `.superpowers/brainstorm/polish2/index.html`.
Built in `.claude/worktrees/polish-pass-2`. The landing page (PR #5) was merged into the branch partway through.
No score, calculation or data-source change.

| Area | What changed |
|---|---|
| Type | Inter optical-size file (`opsz`); one scale in `@theme` with a line height and tracking per size (three arbitrary sizes stay as exceptions: ScoreHero `text-[0.8rem]`, NightReport `text-[17px]`, CompareStep `text-[13px]`); no `tracking-tight`/`tracking-[]` and no `leading-tight`, `leading-snug` or `leading-none` overrides in components; digits that must align use `tabular-nums`, `body` keeps only `cv11` |
| Night vision | Two red text levels (ink `#ee5a4b`, ink-2 and muted `#d24c3f`) and accent `#ff5a47`, each at least 4.5:1 on night, night-deep and panel-2 (contrast test); links underlined in night vision |
| Tonight | One conditions panel; date shown once; notice slot in the page header; touch hint for the strip on phones, hover hint on desktop; one divider above the facts; score hero no longer boxed |
| Target cards | Framing notes shorter, with the S30 FOV-axis caveat stated once per surface; tinted "+ Add" button that keeps its accessible name; the score leads the card; thumbnails show the field width only |
| Explore | One grouped list; targets that are not observable tonight sit in their own section, without status badges |
| Star page | Facts as a list; prose at reading width; no boxed explainer |
| Badges and copy | Two badge styles: `.badge` (neutral) and `.badge-accent` (13 % ice tint, no border) replace every inline `border-ice/40 text-ice` variant; the three em-dashes are gone (CompareStep placeholders are an en-dash, the import message uses a colon); en-dashes in ranges stay; guard tests in `typeScale.test.ts` |

### Commands last run (2026-11-10, on commit 9495fbb; later commits on this branch change only docs)

```bash
cd backend && .venv/bin/python -m pytest -q   # 459 passed, 12 skipped
cd frontend && npx tsc -b                     # clean
cd frontend && npx vitest run                 # 321 passed (32 files)
cd frontend && npm run build                  # built
cd frontend && npx playwright test            # 40 passed, 3 skipped, 1 failed (desktop + mobile)
```

The one Playwright failure is `e2e/landing.spec.ts:80`, "city box opens Tonight for the chosen place (live geocoding,
tolerated when offline)" (mobile project). It comes from main (PR #5), depends on the live geocoding API, and this
branch does not touch it; it was not re-run until green.

### Known limitations (polish pass 2)

- **Night-vision brightness and hue need the developer's dark-room check.** The new reds are brighter and slightly
  more orange (green channel 90, against 53 to 71 before). Two red-only test thresholds were relaxed to fit
  (smoke palette G/B below 100; landing tint 2.5 times instead of 3). Pure red tops out near 5.25:1 on `#050000`,
  so two AA levels need some green. If it is too bright or orange, the options are dimmer reds or one text level.
- **The landing screenshots are stale.** `frontend/public/landing/*.jpg` (merged from PR #6) show the pass-1
  Tonight and must be re-shot after this branch merges.
- **Three arbitrary text sizes are not on the scale:** ScoreHero `text-[0.8rem]`, NightReport `text-[17px]` and
  CompareStep `text-[13px]`. ScoreHero also keeps two inline "Heuristic" spans instead of the shared badge.
- **At night, `--color-ok` is the same red as ink-2** (`#d24c3f`), so "Saved" and coach ok text read like secondary
  text; a fourth distinct AA red does not exist.
- **The opsz font adds about 25 kB.**
- **Settings, AstroLog, Import and the processing coach were not mocked.** They got only the shared rules (type
  scale, badges, copy, night levels).
- **`landing.css` was not audited against the new type scale** (it keeps its own sizes and tracking).
- **Mid-size targets (ratio 0.07 to 0.75) show no fit text**, because the backend emits no note for them (per spec).
- **The frontend `framingNote` thresholds (0.75 and 0.15) differ slightly from the backend's `fit_notes`** (above 0.75, below 1/15); pre-existing.
- **The Tonight e2e tests need live weather** and fail offline.
- **The pass 2 audit's claim that phones got no strip hint was wrong.** The tap hint has existed since pass 1; the
  audit used desktop emulation (`hover: hover`).

### Exact next step (polish pass 2)

The developer reviews the branch `worktree-polish-pass-2` and its PR, including the dark-room check of night vision.
After the merge, re-shoot the landing screenshots in `frontend/public/landing/*.jpg` so they show the pass-2 Tonight.

## Previous work: homescreen landing page (branch `worktree-landing-page`, merged via PR #5)

Built 2026-11-09 from the approved mockup "B v2" (headline first, then the developer's Andromeda photo, then
one night scrolled through the app, a gallery of real captures, and a working city box). Spec:
`docs/superpowers/specs/2026-11-09-landing-page-design.md`; plan: `docs/superpowers/plans/2026-11-09-landing-page.md`.
Decisions made while the developer was away are marked "my call" in the spec.

| Area | Status | Evidence |
|---|---|---|
| `/` is the landing page (outside the app shell); Tonight moves to `/tonight`; every in-app Tonight link updated; shell wordmark links home | done | `App.tsx` (layout route), `AppShell.tsx`, `AstroLogPage.tsx`, `App.test.tsx` |
| Header, hero photo, five story chapters with sticky clock and twilight page sky, gallery, footer attribution | done | `pages/LandingPage.tsx`, `components/landing/`, `styles/landing.css`, `LandingPage.test.tsx` |
| City box: geocode, reuse a saved place within 1 km or save a new one, timezone from coordinates, else Settings with the place prefilled; loading, empty and error states | done | `CitySearch.tsx`, `lib/locationMatch.ts` (+ tests), e2e against live geocoding |
| Night vision on landing pictures: greyscale × accent red (no yellow-green cores) | done | `landing.css`, `e2e/landing.spec.ts` |
| Reduced motion, 390 px with no horizontal scroll, all images load | done | `e2e/landing.spec.ts` (desktop + Pixel 7), browser check |
| Independent code review | done, no blockers | 2 minor items fixed (save reported as failed if only the list refresh failed; mobile clock 5.5 px under the header) |
| README section and screenshots | done | `README.md` "Homescreen", `docs/screenshots/landing-desktop.png`, `landing-mobile.png` |
| Design pass 1 (2026-11-10, developer asked for the Apple design guidance): press feedback, Inter optical-size Display cut for headings with size-specific tracking, rem layout, frosted header, reduce-transparency / increase-contrast fallbacks, gentler reduced motion, clock bar on `transform` | done | `landing.css`, browser check of computed styles under each media setting |
| Design pass 2 (2026-11-10, anti-slop checklist): hero lede cut to 18 words, one CTA, no scroll cue, one label ("See tonight’s sky") for every way into Tonight, one eyebrow on the page, gallery header stacked, footer as sentences, tinted shadows, story clock on IntersectionObserver (no scroll listener) | done | `LandingPage.test.tsx` (one-label test), `e2e/landing.spec.ts` (clock incl. jump to top), Lighthouse mobile: Accessibility 100, Best Practices 100; trace LCP 1.7 s, CLS 0.00 (4× CPU, Fast 4G) |

| Merge with `main` after the polish pass (PR #4) | done | Conflicts resolved in `App.tsx` (imports), `AppShell.tsx` (phone wordmark is a home link with the polish pass's tighter header), `e2e/smoke.spec.ts` (polish-pass tests that opened `/` now open `/tonight`), docs. Merged as PR #5 |
| Landing screenshots re-shot (2026-11-10, branch `landing-screenshots`) | done | All five `frontend/public/landing/*-desktop.jpg` at 1440 × 900 from a scratch server (own ports, sky images off). Tonight, Explore (Orion Nebula) and SS Cygni: sample location, night of 10 Nov. AstroLog library and Compare: the developer's own Bubble (1,015 × 10 s) and Dumbbell (344 × 10 s) nights of 11 Sept, imported into a fresh scratch database under the sample location (their own coordinates were never stored); final pictures are the Seestar's own Bubble stack and the developer's M27 photo; Compare shows their Siril stack (654 × 10 s). Clock times, night label, footer and alt text updated to match |

### Commands last run (after the screenshot re-shoot, 2026-11-10)

```bash
cd backend && .venv/bin/python -m pytest -q           # 453 passed, 12 skipped (run after the merge; the re-shoot changed no backend code)
cd frontend && npx tsc -b --noEmit && npx vitest run  # typecheck clean; 276 passed (25 files)
cd frontend && npm run build                          # built
cd frontend && E2E_API_PORT=8130 E2E_WEB_PORT=5210 npx playwright test   # 36 passed, 2 skipped (phone-only tests on desktop), desktop + mobile
```

### Known limitations (landing page)

- **Photo captions name the object only**, by the developer's choice (2026-11-10). The North America Nebula file was
  named "NGC 7001" by its capture app; the developer confirmed the caption NGC 7000.
- **The landing screenshots are a snapshot of 10 Nov.** If Tonight, Explore, AstroLog, the coach or Variable Hunter
  change look again, re-shoot them; the clock times in `components/landing/content.ts` must match the Tonight shot.
- **The Compare shot shows one side measured.** Only the Siril stack was available; the Seestar's own stacked FITS
  for that night was not, so its side shows the "add a stack" state.
- **Old `/` bookmarks** now open the homescreen; Tonight is one click away (`/tonight`).
- **No night-vision toggle on the landing page.** It honours the saved setting; the toggle lives in the app header.
- The city-box e2e test uses live Open-Meteo geocoding and skips, with a reason, when it is unreachable.
- **Images are full JPEGs.** Lighthouse estimates ~675 kB could be saved with WebP/AVIF and tighter sizes; LCP is
  already 1.7 s on a throttled phone, so this is a later optimisation, not a blocker.
- **`robots.txt` / SEO files do not exist yet** (Lighthouse SEO 92). That belongs with deployment, which is deferred.
- **`prefers-reduced-transparency` is untested in automation** (Playwright cannot emulate it); it reuses the
  increase-contrast rules, which are tested.

### Exact next step (landing page)

1. Developer reviews and merges the re-shot screenshots (branch `landing-screenshots`). Nothing else is open for
   the landing page; WebP/AVIF images and `robots.txt` wait for deployment.

## Previous work: polish pass (merged, PR #4)

Design approved 2026-11-09. Spec: `docs/superpowers/specs/2026-11-09-polish-pass-design.md`; prototype: `docs/superpowers/mockups/2026-11-09-polish/tonight.html`.
Built on branch `worktree-polish-pass` in `.claude/worktrees/polish-pass`, so the main checkout stays free for other work.
Baseline before any change (2026-11-09, in the worktree): `pytest -q` 416 passed, 12 skipped; `npm run typecheck` ok; `npm test` 129 passed.

Task 12 (remaining screens): two Phase 3 tests in `frontend/src/components/variables/variables.test.tsx` changed on purpose. The Star page test no longer expects "Planned for a later phase" (the panel was removed), and the Seestar-note test finds the "Seestar fit · …" label by text because it is now a summary-panel term, not a heading.

### Polish pass: status (2026-11-10)

| Milestone | Status | Evidence |
|---|---|---|
| Foundations: tokens, easing, press states, page widths | done | `index.css`, `index.css.test.ts` |
| `night_clear` (whole-night clear window, API field) | done | `scoring.py::night_clear`, backend tests |
| Night strip, score panel, target card (Tonight redesign) | done | `components/tonight/`, `components/targets/TargetCard.tsx` |
| Sky images (STScI DSS, server cache, switchable) | done | `backend/app/sky_images.py`, `SkyThumb.tsx` |
| Overlays, phone bottom sheet and drag | done | `ui/Overlay.tsx`, `ui/useSheetDrag.ts`, `lib/sheetDrag.ts` |
| Night vision (red-only filter, themed controls, popups) | done | `index.css`, `ui/Select.tsx`, `ui/NightPicker.tsx` |
| Remaining screens carried through | done | Task 12 |
| Task 13 validation: suites, break-ui, animation-performance, improve-animations audit, browser check, screenshots | done | below |
| Real-phone test, dark-room test, developer review, merge and `polish-1` tag | **pending (developer)** | not attempted |

**Suites on 2026-11-10** (worktree, all run on this commit): `cd backend && .venv/bin/python -m pytest -q` 446 passed, 12 skipped (baseline 416 passed, 12 skipped);
`cd frontend && npm run typecheck` ok; `npm test` 215 passed in 20 files (baseline 129); `npm run build` ok; `npx playwright test` 27 passed, 1 skipped (desktop and mobile projects).

**Task 13 findings and fixes**
- `break-ui` on Tonight cards and Library tiles, with worst-case data injected at the network boundary (not committed): an unbroken 60-character target name widened the whole Tonight page to 695 px at 390 px. Fixed with `overflow-wrap: anywhere` on the card title, a non-shrinking score chip, and `title` text on the truncated subtitle line and Library tile name. Library tiles, a long caution line and a 320 px viewport held up without further change.
- Browser check found one night-vision leak: the native checkbox tick ("Observable only") is drawn white by the browser. Checkboxes and radios are now drawn from the palette (`index.css`, test in `index.css.test.ts`). After the fix, every night-vision screenshot (Tonight, drawer, sheet, Explore, Variable Hunter, Star page, Settings, at 1440 and 390 px) has zero pixels whose green or blue exceeds 45 % of red (+4).
- `animation-performance` on the phone sheet and scrim: no frame-budget problem found. Drag writes `transform` and `opacity` straight to styles, no React state, no CSS variable, no layout reads while tracking; the scrim is opacity-only with no backdrop filter. Nothing changed. Still needs a real-device recording.
- `improve-animations` audit (read-only): five LOW findings (cohesion nits and one pre-existing shimmer that animates `background-position`), nothing feel-breaking. Output kept in the sdd folder, not in the repository.
- The `review-animations` pass is assigned to the final whole-branch reviewer.

**Final-review fix wave (2026-11-10)**
- Night headline no longer claims cloud it cannot know: no darkness has its own title; a forecast with no usable values in darkness reads "No forecast yet"; a partial forecast says how much darkness has no forecast (no "through all"); a clear run that ends where the forecast stops reads "Forecast clear until about HH:MM; no forecast after". A Moon-only window is no longer marked best on the night strip.
- Score panel names the real window length ("for the best 1 h 15 min").
- Overlays close only on a click whose target is the scrim itself. On a phone, a tap outside an open select in the header sheet used to close the whole sheet (the select's full-screen backdrop takes the pointerdown, then the click lands on the dialog); an e2e step on the mobile project covers it, and a text selection dragged out of the panel no longer closes it either.
- Library tiles and the target-log final picture go through the night-vision red filter.
- The night-vision popup e2e uses the screenshot rule (green or blue above 0.45 × red + 4) with colours normalised through a canvas; a self-test pins white, grey and `color(srgb 1 1 1)` as failures. In normal mode the same scan reports 15 non-red colours, so it is reading real styles.
- Sky images: the route waits at most 1 s for the fetch lock, then answers 503 with `Retry-After: 5`. The client loads at most two at a time through a shared queue (`lib/skyImageQueue.ts`), retries a busy 503 once after its Retry-After, starts each one only as its card nears the viewport, and keeps the framing diagram meanwhile. With images off, targets carry `sky_field_arcmin: null`, the page requests no images and hides the DSS credit; the e2e console filters for `/sky-image` are removed.
- Small items: drawer scrim on `--ease-drawer`; "Why this score" summary is `w-fit`; night-vision scrollbars use the palette; native date icons use `url(#vision-red)`; the chosen night is `aria-selected` only; `.btn`/`.press` colour transitions use `--dur-press` and `--ease-out`; stale `theme.ts` comment.

**Live sky-image check (2026-11-10, scratch servers on ports 8210/5190, scratch database and `ASTROPLANNER_SKY_CACHE_DIR` in the session scratchpad, nothing committed).** Request: `https://archive.stsci.edu/cgi-bin/dss_search?v=poss2ukstu_red&r=<ra>&d=<dec>&e=J2000&h=<field>&w=<field>&f=gif`. One connectivity probe (a 1′ field, M42) went straight to STScI by curl first.

| Target | r, d (deg) | Field | Cold fetch through the app | Output | Edge trimming |
|---|---|---|---|---|---|
| M31 (first Tonight card) | 10.684792, 41.269056 | 120′ | 17.5 s | 23.9 kB JPEG | **did not behave**: a white plate-edge band about 10 px wide stays near the right edge, because a 1-px black column sits outside it and the outside-in scan stops at the first non-white column |
| NGC 7789 | 359.350250, 56.708278 | 40′ | 2.3 s | 75.0 kB | nothing to trim (brightest edge row or column mean 31) |
| NGC 7000 | 314.821417, 44.528778 | 120′ | 19.0 s | 40.4 kB | nothing to trim (brightest edge mean 95) |

- On Tonight, NGC 7789 was asked for while M31 was fetching: both tries (the first and the one retry 5 s later) got the busy 503 in about 1.02 s, so its card kept the framing diagram on that visit. Other API calls (target details and visibility) answered normally throughout; a cached image is served in about 23 ms.
- Backend memory: about 134 MB resting, 566 MB peak sampled every 0.5 s during the Tonight run, and 645 MB maximum resident set size over the whole run (from `/usr/bin/time -l`, all three fetches included). The 120′ plates are decoded at full size before reduction.

**Suites after the fix wave (2026-11-10, worktree):** `cd backend && .venv/bin/python -m pytest -q` 453 passed, 12 skipped; `cd frontend && npm run typecheck` ok; `npm test` 244 passed in 21 files; `npm run build` ok; `npx playwright test` 28 passed, 2 skipped (both projects; the skips are the two phone-only tests on desktop). On the first full Playwright run, "Themed select works from the keyboard" (desktop) failed once on its final text check. It passed alone, 8 of 8 with `--repeat-each=8`, and in a second full run, so it is recorded as a timing flake, not fixed.

**Exact next step:** developer reviews the fix wave and decides on the two sky-image findings above (the M31 white band left by edge trimming, and a cold Tonight showing only one or two pictures per visit because a busy fetch is retried only once). Then the developer tests on a real phone and in a dark room (sheet drag, card press, night vision, native select popups), reviews the branch, and says whether to merge and tag `polish-1`. Then Phase 5 Design.

Audit finding about the night-vision image filter (yellow-green bright areas in the prototype) is closed: pictures now go through a red-channel-only SVG filter (`#vision-red`); it is covered by tests, but it has not been looked at on a real sky image in a dark room.

### Polish pass: known limitations

- Ten native `<select>` elements remain (Settings timezone, field-of-view definition, minimum altitude and darkness; AstroLog stack and final-picture pickers; target log variable star; import location and per-group controls). The browser draws their open list, which cannot be themed, so in night vision that list may be bright. The Tonight header, filters and date picker use the themed controls.
- Base UI (`@base-ui/react`) added for themed selects and popups: main bundle 289.15 kB to 435.22 kB (gzip 89.99 to 139.02) in Task 11. Accepted for now; no code splitting of it yet.
- Browser-only checks still owed: real-phone touch behaviour of the bottom sheet (drag, flick, catching a closing sheet, iOS Safari address bar and safe areas), press-scale feel on cards, and any frame-rate measurement. These were checked in desktop Chromium with an emulated 390 px viewport only.
- Real-phone and dark-room tests are pending; nothing here claims them.
- Survey pictures need the network on first view per target (STScI DSS, cached on disk afterwards); with `ASTROPLANNER_SKY_IMAGES=off` targets carry no field width, no image is requested and the framing diagram is shown instead.
- On a cold cache the server fetches one survey image at a time (a 120′ field took 17 to 19 s live), and a card whose request finds it busy retries only once, so the first visit to Tonight shows few pictures; later visits fill in from the cache. A white plate-edge band can survive edge trimming when a thin black column lies outside it (seen on M31 at 120′).
- Feel checks owed on a phone (card press while scrolling, flick threshold), dark-room contrast, the remaining native selects and the bundle size are left for later, as above.
- Documentation screenshots of AstroLog (library, target) and Processing Coach were not re-shot: they need the developer's own or synthetic imported data, and carry the previous look.

## Previous phase: Phase 4, Processing Coach: merged and tagged

Merged to `main` on 2026-11-04 (PR #3, merge commit `20bb73d`) and tagged `phase-4`. Spec:
`docs/superpowers/specs/2026-11-03-processing-coach-design.md`; plan: `docs/superpowers/plans/2026-11-03-processing-coach.md`;
methods and sources: `docs/PROCESSING.md`. Phase 3 was merged on 2026-11-03 (PR #2) and tagged `phase-3`.

## Phase 4 open items

1. Supply the Seestar's own stacked FITS for the Bubble Nebula night (`Stacked_1015_NGC 7635_…fit`, on the Seestar): it closes gate G2 (the measured Seestar-vs-Siril comparison is validated on synthetic data only). The Seestar JPEG supplied on 2026-11-04 is a Lightroom iOS edit, so it serves "Final pictures" only.
2. After the polish pass, start Phase 5 Design (scientific image analysis: FITS photometry, user-generated light curves; see `ROADMAP.md`), beginning from a real S30 night as with earlier phases.

Housekeeping (2026-11-04): `process-coach/` (39 GB, coach-generated) and the coach's temp test files were deleted at the developer's request; the merged branches `phase-2-astrolog`, `phase-3-variable-hunter` and `phase-4-processing-coach` still exist locally and on GitHub (deleting them needs the developer's own command). `aavso-live-layer` is unmerged and kept on purpose.

## Phase 4, Processing Coach: build and validation (2026-11-03)

| Area | Status | Evidence |
|---|---|---|
| Gate G1: Siril 1.4.5 script syntax and `.seq` format, from Siril's documentation and source | done | `docs/PROCESSING.md` Sources; probes with `siril-cli` on a synthetic scratch night |
| Migration `0005_processing_runs`, run API, ten-step skeleton, advice rules with a basis on each | done | `app/processing/`, `tests/test_processing_runs.py`, `tests/test_migrations.py` |
| `.seq` / conversion reader | done | `seq.py`, `tests/test_processing_seq.py` |
| Night report (totals, half-hour bins in the observer's timezone, findings, optional low-altitude cause) | done | `report.py`, `tests/test_processing_report.py` |
| Frame-selection options with exact counts (Siril's filter rules) | done | `selection.py`, `tests/test_processing_selection.py` |
| Two generated Siril scripts with disk estimates | done | `scripts.py`, golden files, `tests/test_processing_scripts.py` |
| Stack measurement `coach-measure-2` and advice for background, colour and stretch | done | `measure.py`, `rules.py`, `tests/test_processing_measure.py`, `tests/test_processing_stacks.py` |
| Seestar picture / stack compared with the Siril stack (no score, no winner) | done, synthetic data only | `tests/test_processing_compare.py`, `CompareStep.tsx` (gate G2 open) |
| Coach UI: ten steps, folder picker (reads only `.seq` and `*_conversion.txt`), chart, selection, script downloads, stack upload, compare | done | `ProcessingCoachPage.tsx`, `components/processing/`, unit tests |
| Variable Hunter slot label | changed | "Coming in Phase 4" became "Planned for a later phase" on the star page (the old text was no longer true; the only Phase 1-3 assertion changed) |
| End-to-end on a synthetic night, desktop + mobile | done | `frontend/e2e/processing.spec.ts`, `backend/scripts/make_synthetic_night.py` |
| Docs and screenshots | done | `README.md`, `docs/ARCHITECTURE.md`, `docs/PROCESSING.md`, `docs/screenshots/processing-*.png` |
| Final whole-branch review fixes (12 findings) | done | counts-folder note (`selection_counts`, `scripts.counts_note`), one floored duration format, step-1 wording, 422 on garbled `.seq`, star-fit failure tolerated; `tests/test_processing_review_fixes.py`; report, night-vision and select screenshots re-shot |

### Commands last run (all passing, 2026-11-03)

```
backend:  .venv/bin/python -m pytest -q          → 403 passed, 12 skipped
backend:  ASTROPLANNER_REAL_NIGHT_DIR=… pytest -q tests/test_processing_real_data.py → 5 passed (local only)
frontend: npm run typecheck                       → ok
frontend: npm test                                → 129 passed (12 files)
frontend: npm run build                           → ok
frontend: npx playwright test                     → 18 passed (16 earlier + 2 Processing Coach, desktop + mobile)
```

Phase 1-3 suites are inside those totals and unchanged. The 12 backend skips are 6 AstroLog and 5 Processing Coach
local real-data checks plus 1 Postgres migration test. The e2e Processing Coach test uses only generated synthetic
files (dummy coordinates, header-only FITS, Siril-style text).

### Local real-data validation (local checks on the developer's Bubble Nebula night, not CI)

- Night report on the existing Siril run: 1,015 captured / 851 aligned / 654 kept; median 44 stars per aligned frame; FWHM 2.25 px;
  split "Before 03:30, 51 % of frames reached the stack; from 03:30 on, 91 %"; roundness cut 0.743.
- `siril-cli` 1.4.5, coach script 1 (prepare): 41 s, 1,015 frames converted, 851 registered.
- `siril-cli` 1.4.5, coach script 2 (stack, selection "same as last time"): 66 s; `STACKCNT` 654, `LIVETIME` 6540.
  `lights/` and `process/` fingerprints were identical before and after both runs.
- `process-coach/` used 39 GB; deleted on 2026-11-04 at the developer's request (rebuildable by re-running coach scripts 1 and 2).
- **Acceptance 2b (final review, 2026-11-03): the coach's own run read by the app.** `build_folder` / `night_report` on
  `process-coach/` (`run_dir="process-coach"`, frame times from the `lights/` headers, the real-data test pattern):
  1,015 captured / 851 aligned / 654 kept (8,510 s / 6,540 s), 1,015 matched, no kept-mapping error, round cut 0.743.
  Independent count with `awk` on `process-coach/pp_light_.seq`: 1,015 `I` lines, 1,015 `R1` lines, 851 `R1` lines
  not all-zero; `r_pp_light_.seq` 654 `I` lines; `light_conversion.txt` 1,015 mappings. Totals match.
- **Acceptance 3 (final review): the counts step 4 shows are the counts Siril stacks.** Options from the coach folder's own
  sequence (`selection_options`): `all` 851, `previous` (roundness ≥ 0.743) 654, `round80` 813 (resolves to ≥ 0.652917),
  `wfwhm80` 681 (≤ 4.63952 px). An `awk`/`sort -g` re-computation of both percentage thresholds gave the same
  thresholds and counts. Script 2 from `stack_script` for each, run with
  `siril-cli -d "<night folder>" -s "<full path>/astroplanner-stack-<id>.ssf"` (Siril 1.4.5, exit 0, about 68 s each):
  `round80` → Siril logged "roundness higher or equal than 0.652917 (813)", stack header `STACKCNT` 813, `LIVETIME` 8130;
  `wfwhm80` → "below 4.639520", 681 processed, `STACKCNT` 681, `LIVETIME` 6810. Both equal the option's `kept`.
  Then script 2 for `previous` again: `STACKCNT` 654, `LIVETIME` 6540, 654 `r_pp_light_` files (Siril removes the
  previous run's `r_` files), so the folder is back in its validated state: `process-coach/` names and sizes, and
  `pp_light_.seq`, `r_pp_light_.seq` and `light_.seq` byte for byte, are identical to before.
- Fingerprint of `lights/` and `process/` (`find lights process | xargs stat -f '%N|%z|%m|%HT' | sort`, 4,722 entries)
  before and after the three script-2 runs: `diff` empty, both SHA-256 `2750a05f…5e72ed`. Nothing new in the night folder.
- Stack measurement (`coach-measure-2`) on the real Siril stack: FWHM 2.19 px, noise 0.0405 of the brightness range, gradient 0.156,
  residual 0.026, colour 0.999 : 1.000 : 1.001 with "equalized RGB" in the header.
- UI check in a browser on desktop (1440 px), a 412 px Pixel 7 viewport (no horizontal overflow) and night vision, with this night's
  report, selection, stack advice and compare steps; screenshots in `docs/screenshots/processing-*.png` show no paths or coordinates.

### Known limitations (Phase 4)

- **Gate G2 open:** no Seestar stacked FITS has been supplied, so the measured Seestar-vs-Siril comparison is validated on synthetic data only.
- The Siril GUI route (Scripts menu) is untried; only `siril-cli` was run.
- `rej n` (fewer than 30 frames) was exercised only on a 12-frame scratch run.
- The lights folder name is fixed to `lights` (no UI to change it).
- Frame statistics are frozen when the folder is uploaded; re-importing frames in AstroLog needs a folder re-read in the coach.
- On DST fall-back nights the local clock labels in the split and cause text can be ambiguous.
- `noise_frac` depends a little on star sharpness and is not binning-invariant (documented in `docs/PROCESSING.md`).
- The background model follows only structure larger than 1/8 of the frame; nebula-sized structure stays in the residual.
- A neutral colour reading still has the headline "No strong colour cast measured" (the explanation carries the equalized-RGB caveat).
- The "choice was cleared" notice is not shown after a page reload.
- Step 4's counts describe the folder that was read; when that is `process/`, script 2 (always `process-coach/`) may
  keep a different number. The coach says so on step 4, on the stack step and in the script, but it cannot show
  `process-coach/`'s counts until that folder is chosen.
- On wide screens the night-report chart card stretches to the findings column's height, leaving empty space under the chart.
- Not changed in Phase 4: AstroLog's own FITS previews flip every image regardless of `ROWORDER` and have no night-vision image filter (Phase 2).
- The coach does not use dark, flat or bias frames (it says so).
- Throwaway test files may remain under the system temp folder (`coach-t*`, `coach-fw*`: copies of the screenshot database).

### Phase 4 exit items

- [x] All implementation tasks complete with review
- [x] Full suites run (above) and local Siril validation done
- [ ] Gate G2: Seestar stacked FITS measured
- [ ] Developer review, merge and tag `phase-4`

## Phase 4, Processing Coach: design ✅ approved 2026-11-03 (record)

| Design step | Status | Evidence |
|---|---|---|
| Real S30 night as input | done | Bubble Nebula, 2026-09-11/12: 1,015 frames, re-stacked in Siril 1.4.4 from a tutorial, finished in Lightroom |
| Brainstorm and decisions | done | spec §1, §3, §7 (developer decisions and marked "Claude's call" items) |
| Screen designs (real data, night vision) | done | `processing-guide.html` (night report, coach option B chosen), `compare.html` |
| Builder check of the spec | done | six questions: two settled in the spec, four answered by the developer |
| Implementation plan | done | `docs/superpowers/plans/2026-11-03-processing-coach.md` |

## Phase 3, Variable Hunter: ✅ complete (merged 2026-11-03 in PR #2, tag `phase-3`)

| Area | Status | Evidence |
|---|---|---|
| Curated catalog of 4 stars (SS Cyg, U Gem, T CrB, R Leo) with VSX facts and provenance | done | `app/data/variables.json`, `app/variables/catalog.py`, `scripts/build_variables.py` |
| Tonight's window per star (shared visibility engine; no score) | done | `routes.py`, `tests/test_variables_visibility.py` |
| Missions from AstroLog nights (weekly watch, follow the cycle), plan links (`var:` ids), S30 fit estimate | done | `missions.py`, `fit.py`, API tests |
| AstroLog import and "This is …" linking for variable stars | done | `tests/test_variables_plans_astrolog.py` |
| Variable Hunter list, star page with AAVSO VSX link, `/research` redirect | done | `pages/VariableHunterPage.tsx`, `StarPage.tsx`, `components/variables/`, unit tests |
| End-to-end: nav, redirect, star page, plan add survives reload, desktop + mobile | done | `frontend/e2e/variables.spec.ts` |
| Docs and screenshots | done | README, `docs/ARCHITECTURE.md`, `docs/screenshots/variable-hunter-*.png` |
| Live AAVSO observations (light curves, sky alerts, outburst mission) | **removed** | kept on branch `aavso-live-layer`; see G1 |
| Photometry and AAVSO submission | not in Phase 3 | page shows a labelled "Planned for a later phase" slot (was "Coming in Phase 4" until Phase 4 shipped without photometry) |

### Gate G1 (AAVSO terms): closed by removing the live layer

- Read: VSX's own copyright page (2026-11-02): "personal, non-commercial use only", and no mirroring on another server without permission.
- Read: AAVSO "Search and Download Data" page (pasted by the developer, 2026-11-03): AAVSO data are "free for your own personal use and for use in publications provided you follow our Data Usage Guidelines". It says nothing about third-party apps or automated access, so G1 stays open.
- Read: AAVSO Data Usage Guidelines, 2026-07-16 revision (PDF supplied by the developer, 2026-11-03, not committed). They cover acknowledgement in *publications*: observer acknowledgement, the AID acknowledgement sentence ("We gratefully acknowledge the contributions of the AAVSO observer community, whose [photometric, ...] data and metadata resources were used in this study and made available through the AAVSO's scientific archives."), the VSX citation (Watson, Henden & Price 2006, SAS vol. 25, p. 47), facility keywords, and notifying aavso@aavso.org of publications. They say **nothing** about third-party apps, displaying data to others, or automated/programmatic access: no permission, no prohibition.
- Read: AAVSO forum thread on programming interfaces (pasted by the developer, 2026-11-03). A post dated 2020-05-24 documents `api.object` and `api.list` and says "The VSX API is not 'official' yet"; AAVSO-affiliated members help third-party app authors use these endpoints; a 2021-01-21 post says AAVSO is "having problems with internet robots pounding on these interfaces". The thread does **not** mention `api.delim` (the observations endpoint the live layer uses) or displaying AID observations in third-party apps. Reading: programmatic `api.object` catalog lookups (build script, run once) are tolerated in practice; the live observation layer has no documented permission.
- Outcome (developer decision, 2026-11-03): no document covers a third-party app downloading and showing AID
  observations, so the live layer (VSX `api.delim` provider, observation cache, light curves, sky alerts, outburst
  mission, migration `0005_variable_hunter`) was removed rather than emailing AAVSO. Phase 4's own measurements make it
  unnecessary. The app makes no AAVSO requests at runtime; only the build script calls `api.object`, once per star.
- The developer's local database was backed up and downgraded from `0005_variable_hunter` to `0004_capture_exif`
  (the three variable tables were empty) before the migration file was deleted.

### Commands last run (all passing, 2026-11-03, after removing the live layer)

```
backend:  .venv/bin/python -m pytest -q          → 232 passed, 7 skipped
frontend: npm run typecheck                       → ok
frontend: npm test                                → 83 passed (8 files)
frontend: npm run build                           → ok
frontend: npx playwright test                     → 16 passed (desktop + mobile)
```

Phase 1 and 2 suites are unchanged and inside those totals. No test contacts AAVSO.
(The 7 backend skips are the same 6 local real-data checks and 1 Postgres test as in Phase 2.)

### Known limitations (Phase 3)

- No light curves or outburst alerts: AstroPlanner shows no AAVSO observations (see G1). Star pages link to AAVSO VSX.
- VSX catalog facts are used under "personal, non-commercial use only"; a public deployment needs AAVSO's permission
  for them (ROADMAP.md, Deployment).
- Converting a custom target with "This is ..." does not back-fill earlier plan links.
- S30 brightness limits (7 to 12.5) are an unmeasured estimate, shown as one.
- The e2e "add to tonight's plan" check returns early (still asserting the stated reason) if SS Cyg is not observable that night.
- No predictions of any kind (eruption dates, eclipse timetables) by design.

### Phase 3 exit items

- [x] All implementation tasks complete with review
- [x] Full suites run (above)
- [x] G1 decided: live AAVSO layer removed, preserved on `aavso-live-layer`
- [ ] Developer review, merge and tag `phase-3`

## Phase 2, AstroLog: ✅ complete (signed off 2026-11-02, merged in PR #1, tag `phase-2`)

Spec: `docs/superpowers/specs/2026-11-02-astrolog-design.md`. CI green on the merge commit (run 41567244494).

| Area | Status | Evidence |
|---|---|---|
| Alembic migrations (baseline + AstroLog), SQLite and Postgres | done | `backend/migrations/`, `tests/test_migrations.py` (Postgres test runs in CI via `TEST_POSTGRES_URL`) |
| FITS / CR2 header and filename parsing | done | `app/astrolog/headers.py`, `tests/test_astrolog_headers.py` |
| Header-based import preview and commit (nights, capture sets, dedup, plan attach) | done | `importer.py`, `tests/test_astrolog_import.py` |
| Final-picture previews (metadata-free) | done | `previews.py`, `tests/test_astrolog_previews.py` |
| Library, target page, history, plan vs actual | done | `library.py`, `tests/test_astrolog_library.py` |
| Local real-data acceptance (AC 1, 2, 4, 5) | done | `tests/test_astrolog_real_data.py`, 6 passed locally |
| Folder import UI (headers sliced in the browser) | done | `AstroLogImportPage.tsx`, `lib/headerSlice.ts` |
| Library and target pages, nights page | done | `LibraryPage.tsx`, `TargetLogPage.tsx`, `AstroLogPage.tsx` |
| "You have ... stacked/captured" badge on Tonight and Explore cards | done | `HistoryBadge.tsx`; e2e-verified on Explore, unit-tested on the shared card (Tonight uses the same card; not e2e-checked because Tonight shows only that night's recommendations) |
| End-to-end import test, docs, Phase 1 regression | done | `frontend/e2e/astrolog.spec.ts`, screenshots in `docs/screenshots/` |

### Final review fixes (2026-11-02)

The whole-branch review's four important findings and seven minors are fixed
(`.superpowers/sdd/2026-11-02-astrolog/final-fixes-report.md`):
"% used" now divides by the frames inside the linked stack's EXPSTART–EXPEND (returned as
`frames_in_stack_range`) and is hidden when that can't be computed; Canon ISO, f-number, focal
length and lens are stored (migration `0004_capture_exif`) and shown with their EXIF keys;
nights show local first → last frame times and per-frame exposure, and imported sessions get
start/end from their frames; "Move to Unsorted" merges into one Unsorted group (PATCH on it is 409).
Minors: stack suggestion from the chosen file name, "in the latest stack" wording, "nights unknown",
`formatIntegration` flooring, clearer night-delete 409, small UI cleanups, stronger migration tests.

### Commands last run (all passing, 2026-11-02, after the final review fixes)

```
backend:  .venv/bin/python -m pytest -q          → 198 passed, 7 skipped
frontend: npm run typecheck                       → ok
frontend: npm test                                → 69 passed (7 files)
frontend: npm run build                           → ok
frontend: npx playwright test                     → 12 passed (10 Phase 1 smoke + 2 AstroLog import, desktop + mobile)
local:    ASTROPLANNER_REAL_DATA=<folder> pytest tests/test_astrolog_real_data.py -v
                                                  → 6 passed (the 6 backend skips are these; the 7th is the Postgres test)
```

Phase 1 remains green: 66 backend tests, 23 unit tests and 10 smoke tests are all still in the totals above.
Screenshots (`astrolog-library-desktop.png`, `astrolog-target-desktop.png`) use synthetic data only.

### Known limitations (Phase 2)

- Only Seestar S30 FITS and Canon CR2 are understood; other cameras' files are skipped with a reason. Canon model names from other regions (EU/JP) are not matched to the seeded Canon profile.
- A re-import never moves frames that are already imported. To fix a wrong set name or target, change it on the target page; to fix a wrong location you would have to delete the captures and import again.
- A multi-batch commit (more than 300 files) is not atomic. If it stops part way, the review shows what is still new and a retry is safe because frames are de-duplicated. After such a failure the names, "Unsorted" choices and plan choices you made on the review screen are reset.
- If you leave the Settings round-trip ("create location from file") without coming back, a later visit to Import can reopen the old folder's review.
- Final-picture upload: the file is spooled before the 150 MB check, so a huge upload uses temporary disk first. Colour profiles are not converted to sRGB, the TIFF orientation tag is ignored, and a CMYK TIFF loses its fourth plane. Only a preview is kept, never the original.
- Two simultaneous final-picture uploads for one target on Postgres could leave two "current" pictures.
- Deleting a session that has capture sets returns 409 by design. Under a simultaneous import the check could return 500 instead.
- No cross-process migration lock; revisit at deployment. Deployment is still deferred.
- Canon frames imported before migration 0004 have no ISO / f-number / focal length / lens stored; re-importing does not back-fill them (frames are never rewritten).
- "% used" on the real Bubble Nebula data is 654 of 1,012 (65%), not the 64% in acceptance criterion 2: the last 3 of the 1,015 lights start after the stack's EXPEND, and spec §7a defines the denominator as the frames inside EXPSTART–EXPEND.

## Phase 2 exit items

- [x] All implementation tasks complete with review
- [x] Full suites and local real-data acceptance run (above)
- [x] Developer review → signed off 2026-11-02; merged to `main` (PR #1, merge commit `47cb832`)
- [x] CI green on the PR and on the merge commit, including the Postgres migration test

## Phase 1, core planning dashboard: ✅ complete (signed off 2026-11-02, tag `phase-1`)

The record below is kept as Phase 1's final state.

| # | Spec item | Status | Evidence |
|---|---|---|---|
| 1 | App shell: Tonight, Explore, Research Lab, AstroLog, Settings | ✅ | sidebar (desktop) / bottom nav (mobile); `docs/screenshots/` |
| 2 | Manual location (city search / coordinates), timezone, saved; opt-in geolocation; labelled sample location | ✅ | `/api/geocode`, `/api/timezone`, `/api/locations`; Settings page |
| 3 | Verified Seestar S30 preset + custom profiles | ✅ | preset immutable (403), duplicate → custom; `fov_definition: unknown` |
| 4 | Real forecast with loading / error / no-data / last-updated | ✅ | Open-Meteo adapter, cache, statuses `ok/unavailable/error`, lead-time label, past-night note |
| 5 | Accurate Sun, Moon, target positions; local-night timeline | ✅ | Astropy; USNO/Meeus reference tests |
| 6 | Tonight's Score 0–100 with documented components | ✅ | `docs/SCORING.md`; no total without weather |
| 7 | ≥ 20 sourced targets with distinct IDs | ✅ | 58 OpenNGC targets, pinned commit, provenance per target |
| 8 | Ranked, filterable target cards + altitude-vs-time graph | ✅ | `/api/recommendations`, sparklines, detail chart |
| 9 | Target detail: identifiers, coordinates, chart, Moon separation, best (forecast-adjusted) window, Add to Session | ✅ | Explore drawer |
| 10 | Sessions: create, add, reorder, remove, persist across reloads | ✅ | API test incl. restart persistence; Playwright e2e incl. reload |
| 11 | Deterministic astronomy/scoring tests, responsive layout, README | ✅ | 66 backend + 23 frontend unit + 10 e2e tests |

### Completed in the latest increment (Phase 1 review feedback: new theme)

- New visual theme **"Clean Planetarium"**, chosen by the developer from three mockups:
  near-black sky with a static, seeded starfield (`scripts/gen-starfield.mjs`), white type,
  Inter as the only font, one blue accent for interactive and "best" highlights, muted
  orange for cautions. The previous serif headings and gold accents are removed.
- **Night-vision mode**: header toggle turns the entire app dim red (text, charts,
  starfield, score) via CSS variables on `<html data-vision>`; persisted, applied before
  first paint, charts re-read theme colours on toggle. New e2e test verifies red-dominant
  text and persistence across reload.
- Mobile header is no longer sticky (it grew to four rows); desktop header still sticky.
- Doc screenshots regenerated in the new theme (incl. `tonight-night-vision.png`).

### Completed in the previous increment

- `ROADMAP.md` created; phase numbering adopted across UI and docs (AstroLog = Phase 2,
  Variable Hunter = Phase 3, image analysis = Phase 4).
- Accessible confirmation dialog (native `<dialog>`, focus on Cancel for destructive actions)
  replaces `window.confirm()` for session, location and equipment deletion.
- Equipment selector visible in the mobile header.
- Code splitting: lazy routes and lazy Recharts charts; main JS 725 kB → 348 kB (108 kB gzip).
- Playwright smoke suite (`frontend/e2e/smoke.spec.ts`): runs real backend on a fresh DB on
  dedicated ports (8100/5180); desktop + Pixel 7 projects.
- Geocoding maps Open-Meteo's −9999 elevation sentinel to "unknown".

### Commands last run (all passing, 2026-11-02)

```
backend:  .venv/bin/python -m pytest -q     → 66 passed
frontend: npm run typecheck                  → ok
frontend: npm test                           → 23 passed
frontend: npm run build                      → ok, no chunk-size warning
frontend: npm run test:e2e                   → 10 passed (desktop + mobile, incl. night vision)
manual:   new theme + night vision reviewed in browser (Tonight, Explore detail, Settings,
          confirm dialog) at 1440 px and 390 px
```

### Acceptance criteria (spec §11)

1 run locally ✅ · 2 forecast or explicit unavailable, date persists ✅ · 3 ≥ 20 targets + search ✅ ·
4 altitude realistic + 2+ independent references ✅ (`docs/ASTRONOMY.md`) · 5 no daytime-only
recommendations, 30° enforced ✅ · 6 twilight/Moon/local times computed and in observer tz ✅ ·
7 components sum, bounded, no fake weather ✅ · 8 add/remove/reorder/persist ✅ · 9 responsive +
empty/error states ✅ · 10 no fake observations/events ✅ · 11 tests for seasons, DST, no darkness,
never visible, no forecast, normalization ✅ · 12 README + architecture + next checklist ✅

## Known limitations

- **Not deployed.** Runs locally; repo and CI are on GitHub.
- CI uses `actions/*@v4/v5`, which GitHub now force-runs on Node 24 (deprecation warning, not a failure).
- Altitudes ignore atmospheric refraction (≈1.7′ at 30°); no local horizon/obstruction model.
- Weather cache is in-process memory; model run time is not available from the endpoint used.
- Score weights are heuristics, uncalibrated against real outcomes.
- E2E tests call live Open-Meteo; they tolerate either a forecast or an explicit unavailable state.
- (Closed in Phase 2: schema now uses Alembic migrations.)

## Phase 1 exit items (all closed)

- [x] Git + GitHub: https://github.com/JoeyPhatsJr/astroplanner (public); first CI run green
      (backend, frontend, e2e jobs; run 41532298528)
- [x] Deployment: deferred until the project is nearly complete (ROADMAP.md, "Deployment")
- [x] Phase 1 review with the developer → signed off 2026-11-02 (after theme feedback was addressed)
