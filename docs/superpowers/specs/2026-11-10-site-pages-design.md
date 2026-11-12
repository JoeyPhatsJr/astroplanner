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
| An account stores the email, an Argon2id password hash (never the password) and sign-in sessions (only a SHA-256 hash of each session token) | `backend/app/accounts/models.py`, `backend/app/accounts/core.py` (added 2026-11-11) |
| Accounts live in the same local database as everything else | `users` and `user_sessions` tables, migration `0006_accounts` (added 2026-11-11) |
| Deleting an account removes it, its sign-in sessions, its session plans and nights, its AstroLog library, its processing notes and their preview files; original files are never touched | `backend/app/accounts/deletion.py`, `POST /api/auth/delete` in `backend/app/accounts/routes.py` (added 2026-11-11) |
| Saved places and equipment are shared by everyone using the app, so deleting an account leaves them; they are removed in Settings | `/api/locations` and `/api/equipment` have no owner (accounts spec, Non-goals); `deletion.py` does not touch them (added 2026-11-11) |

If any of these change before the build, the page text changes with them.

**Correcting approved copy (my call, from the builder check).** Headlines, structure and tone are fixed as in the mockup.
Any sentence the code does not back up is corrected during the build: accuracy outranks the mockup's wording. Two known
corrections:

- Privacy, "Deleting": besides the database file and the preview folder, the browser keeps this site's saved preferences
  (`astroplanner.prefs.v1`: chosen place and equipment, active session, night vision; `astroplanner.sidebar`). The text
  becomes: "Everything AstroPlanner keeps about you sits in one database file and one preview folder on your computer,
  plus a few saved preferences in your browser. Deleting them, and clearing this site's data in your browser, removes it
  all." The database sentence stays true only for the default setup: if `DATABASE_URL` points elsewhere (Postgres), say
  so in one short clause.
- Terms: add "Updated 10 Nov 2026" under the lede, so the "Changes" sentence ("the date at the top changes too") is true.

**Not shipped (my call):** the dashed "For the login design" box at the end of the mockup's Privacy view was a note to the
developer, like the Accounts plan tab. It is not part of the public page (see Non-goals).

**Also settled during the builder check (my calls):**
- Header: extract the homescreen's existing `.landing-header` (which already has the reduced-transparency and
  increased-contrast fallbacks) into the shared header, and add the 44 px pill and phone mark-only fold. The mockup's CSS
  is a picture, not code to copy.
- "Source on GitHub" links to the public repository, github.com/JoeyPhatsJr/astroplanner.
- Credits uses the full DSS acknowledgment text that `/api/about` already returns.
- Settings keeps its own "Data sources" list unchanged.
- The app shell's existing attribution line gains links to How it works and Privacy, so app pages reach them too.

## Constraints

- CLAUDE.md: attribution and license terms respected; accessible labels; responsive; no dead buttons; PROGRESS.md kept.
- Existing look: tokens in `frontend/src/index.css`, homescreen styles in `frontend/src/styles/landing.css`.
- The homescreen's own footer note ("Photos, and the AstroLog and processing screens, come from the developer’s own
  nights...") stays on `/`, above the shared footer.
- Sequencing: polish pass 2 (PR #7, open on 2026-11-10) changes `LandingPage.tsx`, `landing.css`, `index.css`,
  `AppShell.tsx` and the landing and smoke e2e specs. Build from `main` after PR #7 merges, and take the header and type
  rules from that version, not from this mockup's copied values.
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
