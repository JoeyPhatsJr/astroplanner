# Accounts and sign-in: design

Date: 2026-11-11 · Status: approved; built on branch `login-design` (amended 2026-11-11 to match what shipped, see "Amendments")
Mockup: `docs/superpowers/mockups/2026-11-11-login/index.html` (serve the repo root, open that path)

## Intent

AstroLog and the Processing Coach hold a person's own nights, pictures and processing notes. The developer decided
(2026-11-11) that both require an account. Login comes before deployment, and the developer chose **local accounts in
the backend** (not Supabase yet): the FastAPI app stores accounts itself, so sign-in works offline on the developer's
computer. At deployment, Supabase Auth replaces this (ROADMAP "prerequisites before going public").

## Goals

1. Create an account, sign in, sign out, change password, delete account.
2. AstroLog (`/astrolog/**`), the Processing Coach (`/astrolog/process/**`) and **session plans** require a signed-in
   user, in the UI and the API. Everything else stays open: homescreen, site pages, Tonight's sky, score and targets,
   Explore, Variable Hunter star pages, Settings.
3. Each user sees only their own plans, nights, AstroLog and Processing Coach data, and only their own progress.
4. The header's empty sign-in slot (site header and app shell top bar) becomes "Sign in" when signed out and the account
   initial with a menu (AstroLog, Account, Sign out) when signed in, as in the mockup.
5. Privacy gains a "Your account" section that states exactly what an account stores and how deleting works.

## Non-goals

- No Supabase, no hosting, no email sending, no social sign-in, no multi-factor auth, no admin UI.
- Saved places and equipment stay shared and unowned in this build (they work signed out today). Syncing them per
  account is a later decision. Known limitation, accepted for a single-computer install (my call): anyone using the
  app can edit a saved place, and a night's times and the coach's altitude numbers are computed from its place, so
  editing a place changes them. Document it in PROGRESS; revisit before deployment.
- No change to how Tonight, Explore or Variable Hunter compute anything.

## Anti-goals

- Any way to read or change another user's AstroLog or coach data, through the UI or the API.
- Passwords or session tokens in logs, URLs, localStorage, or error messages.
- An error that says whether an email has an account ("no account with that email"): sign-in failures read the same.
- A button or link that does nothing (CLAUDE.md), including "Forgot password?" pointing at an email that can't be sent.
- Losing the developer's existing local AstroLog data when accounts arrive.

## Decided

- By the developer: AstroLog and the Processing Coach require an account; local accounts in the backend now, Supabase
  Auth at deployment.
- By the developer (builder check, 2026-11-11): **session plans need an account too.** In the code an AstroLog night is
  a session plan (`sessions` rows; `capture_sets.session_id`), so every plan and night belongs to one account. Signed
  out, Tonight still shows the sky, score and targets, but "Add to session" and the session plan panel ask you to sign
  in.
- By the developer (builder check): **progress is personal.** Variable Hunter mission progress and night counts, and the
  "You have … stacked" badges on Tonight and Explore, show only the signed-in user's own data; signed out, star pages
  and cards show everything except personal progress (no badge, no streak, no error).
- Approved in the mockup: screens and copy for Sign in, Create account, AstroLog signed out, Account (with type-DELETE
  confirmation), and the signed-in header menu; the design-skills pass (44 px targets, press feedback, account menu as a
  disclosure of links, reduced-motion / transparency / contrast fallbacks, 360 px wordmark fold).

## Changed from the mockup (my calls, because there is no email sender)

- **No "Check your email" step.** Creating an account signs you in and opens AstroLog. The mockup's "Done" state is not
  built.
- **"Forgot password?"** opens a short page: "AstroPlanner runs on your computer, so a password is reset from the
  terminal:" followed by the exact command (`cd backend && .venv/bin/python -m app.accounts reset-password
  you@example.com`), which prompts for a new password. At deployment, Supabase's email reset replaces it.
- Create account says "You’ll be signed in right away." instead of the email line.

## How it works (my calls unless marked)

- **Passwords:** Argon2id via `argon2-cffi` (new backend dependency), default parameters; minimum 12 characters,
  maximum 1024; checked server-side (the UI check is a convenience). Emails are trimmed and lower-cased; unique.
- **Sessions:** server-side table (`user_sessions`: id, user_id, token hash, created_at, last_seen_at, expires_at).
  The browser holds a random 256-bit token in an `HttpOnly`, `SameSite=Lax`, `Path=/` cookie (`Secure` when served over
  HTTPS); only its SHA-256 hash is stored. Sessions last 30 days, renewed on use. Sign out deletes the session; changing
  the password deletes the user's other sessions; deleting the account deletes all.
- **Cross-site requests:** state-changing `/api/**` requests must carry `X-Requested-With: AstroPlanner` (the frontend
  client adds it); with `SameSite=Lax` this blocks cross-site form posts.
- **Sign-in throttling:** after 5 failed attempts for an email within 15 minutes, further attempts for it are refused
  for 15 minutes with the same generic message plus "Try again in a few minutes." (in memory; resets on restart).
  Sign-up is throttled the same way per client address.
- **Existing email at sign-up (my call):** "An account with this email already exists. Sign in instead." (with a link).
  The no-enumeration anti-goal applies to sign-in; with no email step, sign-up cannot hide it without being useless.
- **API:** `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` (200 with
  `{email, created_at, claimed_existing}` or 401), `POST /api/auth/password` (current + new), `POST /api/auth/delete` (password +
  `confirm: "DELETE"`). One FastAPI dependency (`current_user`) resolves the cookie; every AstroLog and coach route uses
  it and returns 401 without a session. Swapping to Supabase later means replacing that dependency.
- **Ownership:** `owner_id` (FK to users, indexed) on `sessions` (plans and nights) and on every AstroLog and coach table
  that holds a person's data (library targets, capture sets, frames, stacks, final images, processing runs, and any
  other table those routes write). `session_targets` has no `owner_id`: it is reached only through its owned
  `sessions` row, and the database cascade removes it with that row. Every query filters by owner, including cross-row ones (the importer's night
  matching, plan candidates, the coach's previous-run lookups); a row owned by someone else answers 404, not 403.
  Unique keys that are global today become per owner (library target normalised key, including the single "Unsorted"
  row; frame and stack dedup keys), so two people importing the same files do not collide. Preview files are served
  only through routes that check ownership.
- **Session API:** `/api/sessions/**` requires a signed-in user and returns only that user's plans and nights (the
  Tonight session panel and the AstroLog Nights page both use it). An import attaches only to the importer's own plans.
- **Open routes that read personal data** (Variable Hunter missions and night counts, `/api/astrolog/history` for the
  badges): use an optional-user dependency; signed out they return no personal data (and no 401), signed in only the
  user's own. The frontend requests badges only when signed in.
- **Existing data:** rows that exist before accounts have no owner (sessions included). The first account created on an
  install takes them over, once, and the Account page says "Your existing plans and AstroLog library were added to this
  account." No other account ever sees them.
- **Delete account:** removes the user, their sign-in sessions, their owned rows (plans and nights included) and their
  preview files, deleting in dependency order in code (foreign keys stay RESTRICT). This is the one deliberate exception
  to ROADMAP's rule that imported observations are never deleted as a side effect: here the deletion is the explicit,
  confirmed request. Record it as a ROADMAP decision row. Original files on the computer are never touched.
- **Migration:** two Alembic migrations, `0006_accounts` (the `users` and `user_sessions` tables) and `0007_ownership`
  (the `owner_id` columns and the per-owner unique keys), work on SQLite and Postgres (`DATABASE_URL`) and keep
  existing rows (owner null until claimed).
- **Frontend:** a session query (`/api/auth/me`) drives the header slot and the AstroLog gate. Routes `/login` and
  `/signup` live in the site layout; `/account` and `/login/reset-help` in the app shell or site layout as the mockup
  shows. After sign-in, return to the page that asked (e.g. `/astrolog/targets/…`), else `/astrolog`. On a 401 from an
  AstroLog call, show the signed-out AstroLog screen, never a raw error. Forms follow the web guidelines: labels,
  `autocomplete` (`email`, `current-password`, `new-password`), inline errors, focus the first error on submit, buttons
  stay enabled until the request starts and read "Signing in…" while it runs.
- **Privacy page:** new "Your account" section: email, a password hash (never the password), and sign-in sessions;
  where they live (the same local database); how delete works. "What it keeps" gains "Your account: your email and a
  password hash". Update the facts table in the site-pages spec accordingly.

## Constraints

- CLAUDE.md: no dead buttons, accessible labels, loading/error/empty states, attribution, PROGRESS.md kept, no claimed
  tests that were not run.
- The four design skills apply to every screen built (developer's standing rule).
- `DATABASE_URL` seam stays working (no SQLite-only SQL).
- Existing tests and e2e flows that use AstroLog or the coach must sign in first (a test helper creates a user).

## Left to the builder

- Module layout in `backend/app/` (suggested `accounts.py` for models, hashing, sessions and the `current_user`
  dependency; routes in the existing API style) and the CLI entry for password reset.
- Frontend component structure (suggested `components/account/`), and whether the AstroLog gate wraps routes or pages.
- Exact table names, as long as they follow existing naming.
- Cross-origin `VITE_API_BASE` mode is not supported with accounts in this build (the dev proxy and e2e servers are
  same-origin, so cookies work as is); say so in the README.
- Test shape, as long as it covers: hashing and verification; session creation, expiry and revocation; generic sign-in
  errors; throttling; every AstroLog, coach and session route returning 401 signed out; two users unable to see or change each
  other's data (plans, nights, imports with identical files, preview files, mission progress, badges); signed-out
  Variable Hunter and badge routes returning no personal data; first-account claim of existing data; delete account removing owned rows and
  files; an e2e flow (create account, open AstroLog, sign out, AstroLog shows the signed-out screen, sign in again).

## Amendments (2026-11-11, during the build)

The plan (`docs/superpowers/plans/2026-11-11-accounts.md`, "Spec decisions made in this plan") corrected the points
below; the text above now matches what shipped.

- **Password hash, not "encrypted password".** A hash cannot be decrypted; Privacy says "a password hash (never the
  password itself)" and "Your account: your email and a password hash".
- **`/api/auth/me` also returns `claimed_existing`**, so the Account page can show "Your existing plans and AstroLog
  library were added to this account." only to the account that took them over.
- **Two migrations** (0006, 0007), so each build step ends with its schema matching the ORM.
- **`session_targets` stay unowned** (reached only through an owned session).
- **Copy:** the AstroLog gate reads "AstroLog keeps your library, final pictures and processing notes with your
  account. Sign in to open it." The approved "so they’re there on any device" was dropped: with local accounts the
  data lives on one computer. The Account page's "Your data" and the delete dialog name session plans too, since plans
  are owned, and the delete dialog has a Password field because `POST /api/auth/delete` requires one.
- **Delete stays disabled until DELETE is typed and a password is entered**, as in the approved mockup. This is the
  one exception to "buttons stay enabled until the request starts".
