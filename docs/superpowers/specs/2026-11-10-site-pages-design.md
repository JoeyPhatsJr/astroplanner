# Site pages around the homescreen: design

Date: 2026-11-10 · Status: mockup approved by the developer, spec awaiting approval
Mockup: `docs/superpowers/mockups/2026-11-10-site-pages/index.html` (serve the repo root, open that path)

## Intent

The homescreen (`/`) tells the story. Before accounts arrive (login is the next piece of work), the site needs the pages
people expect from an app that will hold their data: what it stores, how its numbers are made, whose data it uses, and the
terms. For AstroPlanner these are also a selling point and resume evidence: the privacy story is unusually strong (image
data never leaves the computer) and the methods are documented and tested.

## Goals

1. Four public pages, outside the app shell, sharing the homescreen's header:
   - `/how-it-works`: how sky positions, Tonight's Score and target ranking are computed, and what the app won't claim.
   - `/privacy`: what is read, kept, sent elsewhere, and not present; how to delete.
   - `/credits`: every data source and library with its license and terms.
   - `/terms`: a short plain-language summary, visibly marked as a draft.
2. A shared site layout: the homescreen's header (logo, nav Explore / AstroLog / Variable stars, "See tonight’s sky")
   and a new footer (blurb, App links, About links, attribution line) used by `/` and the four pages.
3. Login prep: the header has a place for a sign-in control, but renders nothing there until login works.

## Non-goals

- No login, accounts, sign-in button, or account section on Privacy (that comes with the login design).
- No pricing, testimonials, user counts, "trusted by" logos, blog, careers or changelog.
- No change to the app shell (`/tonight` and the other app routes) beyond what links require.
- No legal review; Terms stays labelled as a draft.

## Anti-goals (a failure even if it works)

- Any claim on these pages that the code does not back up today (CLAUDE.md: no fabricated data or claims).
- A visible but non-working "Sign in" control (no dead buttons).
- A second copy of the header CSS that drifts from the homescreen's.
- More than one label for the way into Tonight: it is "See tonight’s sky" everywhere, footer included.

## Decided (by the developer, or approved in the mockup)

- Content and layout as in the mockup, including headlines: "Every number shows its work.", "Your pictures stay yours.",
  "Built on open science.", "Plain terms." (The developer chose "shows its work" over "shows its working".)
- Routes: `/how-it-works`, `/privacy`, `/credits`, `/terms`.
- Proposed account model, recorded for the login design, not built: Tonight, Explore, Variable Hunter and these pages stay
  open without an account; an account syncs places, equipment and plans. Open question for the login design: whether
  AstroLog and the Processing Coach need an account once hosted.
- Visual rules from the design passes: frosted header with reduced-transparency and increased-contrast fallbacks and no
  hard divider; balanced headings; rem type; focus-visible rings; skip link; press feedback (scale on pills, dim on
  links); 44 px tap targets; reduced-motion fallbacks; no em or en dashes in visible text; night vision honoured from the
  saved setting (no toggle on these pages, as on `/`).
- Phone: one header row always. With a second action (later: Sign in or the account initial) the wordmark folds to the
  mark, keeping "AstroPlanner" for screen readers, as `AppShell` already does on small phones. Checked at 320 and 390 px.

## Facts the pages state, and their sources

Every statement must be traceable. Sources at the time of writing:

| Claim | Source |
|---|---|
| Score parts 45 / 25 / 20 / 10, forecast vs calculated, best 2 h window, no forecast means no total (out of 30) | `docs/SCORING.md`, `backend/app/scoring.py` |
| Ranking parts 30 / 25 / 25 / 20, 30 min minimum window, out of 75 without forecast | `docs/SCORING.md` |
| USNO, DST, southern-hemisphere, midnight-sun and Meeus checks | README "Accuracy", `docs/ASTRONOMY.md` |
| Only FITS/CR2 headers read in the browser; coordinates in files never stored | README "AstroLog" |
| Final picture: metadata-free ~1600 px preview and thumbnail kept | README "AstroLog" |
| Stacks measured in memory; numbers and a small preview kept | README "Processing Coach" |
| Open-Meteo receives saved coordinates and city searches; STScI DSS receives target positions | backend weather, geocoding and sky-image adapters |
| No analytics, ads or trackers; no external fonts or scripts | checked 2026-11-10 (grep of `frontend/src`, `frontend/index.html`) |
| Browser location only via "Use my location" in Settings | `SettingsPage.tsx` |
| Licenses and attributions | README "Data sources and licenses", `backend/app/data/ATTRIBUTION.md` |

If any of these change before the build, the page text changes with them.

## Constraints

- CLAUDE.md: attribution and license terms respected; accessible labels; responsive; no dead buttons; PROGRESS.md kept.
- Existing look: tokens in `frontend/src/index.css`, homescreen styles in `frontend/src/styles/landing.css`.
- The homescreen's own footer note ("Photos, and the AstroLog and processing screens, come from the developer’s own
  nights...") stays on `/`, above the shared footer.
- Tests that already pin homescreen behaviour (one label into Tonight, only real routes linked, e2e landing suite) must
  keep passing, extended to the new pages.

## Left to the builder

- Component structure (suggested: extract `SiteHeader` / `SiteFooter` from `LandingPage.tsx` into a shared site layout
  route; keep page copy as data, as `components/landing/content.ts` does).
- Whether the score and ranking tables on How it works are read from shared constants or written as copy (if copy, a test
  should pin the numbers to the scoring constants so they cannot drift).
- In-page section anchors on How it works, and their `scroll-margin-top`.
- Icons from lucide (already a dependency) in place of the mockup's ✓ / • / ↗ / ✕ characters.
- Test coverage shape, as long as it covers: each route renders outside the app shell; every link goes to a real route;
  the Tonight label rule; no horizontal overflow at 320 and 390 px; night vision turns these pages red.
