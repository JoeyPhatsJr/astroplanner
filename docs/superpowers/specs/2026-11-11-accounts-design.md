# Accounts and sign-in: design

Date: 2026-11-11 · Status: mockup approved by the developer; spec awaiting approval
Mockup: `docs/superpowers/mockups/2026-11-11-login/index.html` (serve the repo root, open that path)

## Intent

AstroLog and the Processing Coach hold a person's own nights, pictures and processing notes. The developer decided
(2026-11-11) that both require an account. Login comes before deployment, and the developer chose **local accounts in
the backend** (not Supabase yet): the FastAPI app stores accounts itself, so sign-in works offline on the developer's
computer. At deployment, Supabase Auth replaces this (ROADMAP "prerequisites before going public").

## Goals

1. Create an account, sign in, sign out, change password, delete account.
2. AstroLog (`/astrolog/**`) and the Processing Coach (`/astrolog/process/**`) require a signed-in user, in the UI and the
   API. Everything else stays open: homescreen, site pages, Tonight, Explore, Variable Hunter, Settings.
3. Each user sees only their own AstroLog and Processing Coach data.
4. The header's empty sign-in slot (site header and app shell top bar) becomes "Sign in" when signed out and the account
   initial with a menu (AstroLog, Account, Sign out) when signed in, as in the mockup.
5. Privacy gains a "Your account" section that states exactly what an account stores and how deleting works.

## Non-goals

- No Supabase, no hosting, no email sending, no social sign-in, no multi-factor auth, no admin UI.
- Saved places, equipment and session plans stay shared and unowned in this build (they work signed out today). Syncing
  them per account is a later decision.
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
- **API:** `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` (200 with
  `{email, created_at}` or 401), `POST /api/auth/password` (current + new), `POST /api/auth/delete` (password +
  `confirm: "DELETE"`). One FastAPI dependency (`current_user`) resolves the cookie; every AstroLog and coach route uses
  it and returns 401 without a session. Swapping to Supabase later means replacing that dependency.
- **Ownership:** `owner_id` (FK to users, indexed) on every AstroLog and coach table that holds a person's data
  (library targets, capture sets, frames, stacks, final images, processing runs, and any other table those routes write).
  Every query filters by owner; a row owned by someone else answers 404, not 403. Preview files are served only through
  routes that check ownership.
- **Existing data:** rows that exist before accounts have no owner. The first account created on an install takes them
  over, once, and the Account page says "Your existing AstroLog library was added to this account." No other account
  ever sees them.
- **Delete account:** removes the user, their sessions, their owned rows and their preview files. Original files on the
  computer are never touched (they were never uploaded).
- **Migration:** an Alembic migration adds the tables and columns, works on SQLite and Postgres (`DATABASE_URL`), and
  keeps existing rows (owner null until claimed).
- **Frontend:** a session query (`/api/auth/me`) drives the header slot and the AstroLog gate. Routes `/login` and
  `/signup` live in the site layout; `/account` and `/login/reset-help` in the app shell or site layout as the mockup
  shows. After sign-in, return to the page that asked (e.g. `/astrolog/targets/…`), else `/astrolog`. On a 401 from an
  AstroLog call, show the signed-out AstroLog screen, never a raw error. Forms follow the web guidelines: labels,
  `autocomplete` (`email`, `current-password`, `new-password`), inline errors, focus the first error on submit, buttons
  stay enabled until the request starts and read "Signing in…" while it runs.
- **Privacy page:** new "Your account" section: email, a password hash (never the password), and sign-in sessions;
  where they live (the same local database); how delete works. "What it keeps" gains "Your account: email and an
  encrypted password". Update the facts table in the site-pages spec accordingly.

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
- Test shape, as long as it covers: hashing and verification; session creation, expiry and revocation; generic sign-in
  errors; throttling; every AstroLog and coach route returning 401 signed out; two users unable to see or change each
  other's data (including preview files); first-account claim of existing data; delete account removing owned rows and
  files; an e2e flow (create account, open AstroLog, sign out, AstroLog shows the signed-out screen, sign in again).
