# Free hosting: Vercel + Render + Supabase

The browser only ever talks to the Vercel site. Vercel serves the React app and forwards `/api/*` to the
FastAPI container on Render, so the session cookie stays first-party (it is `SameSite=Lax`). Render keeps
its data in Supabase: Postgres for rows, Storage for preview images. Nothing is written to Render's disk,
which is wiped on every restart.

```
browser ──> astroplanner.vercel.app ──/api/*──> astroplanner-api.onrender.com ──> Supabase (Postgres + Storage)
```

## What the free tier costs you (measured or documented, not guessed)

| Limit | Why | Setting |
|---|---|---|
| Sky survey images off | one survey fetch peaked near 645 MB; Render free has 512 MB | `ASTROPLANNER_SKY_IMAGES=off` |
| Pictures up to 2.1 megapixels | memory follows pixels: a 4 MP FITS stack peaked near 600 MB, a 2 MP one near 360 MB | `ASTROPLANNER_MAX_MEGAPIXELS=2.1` |
| Uploads up to 4 MB | Vercel Functions cap bodies at 4.5 MB; the limit for proxied rewrites is undocumented (see check below) | `ASTROPLANNER_MAX_UPLOAD_MB=4` |
| First visit after 15 idle minutes takes about a minute | Render free services sleep | none |
| Supabase pauses after a week idle | free plan rule | `.github/workflows/keepalive.yml` pings `/api/health` every 3 days |

The 4 MB limit means Processing Coach's FITS stacks (a Seestar stack is about 24 MB) do not fit until the
large-upload check passes. Final pictures (JPEG, usually under 4 MB) do.

## 1. Supabase (database + storage)

1. Create a project at supabase.com (free plan). Save the database password.
2. **Storage → New bucket** named `previews`, **private** (leave "Public bucket" off).
3. **Connect → Session pooler** (IPv4; the direct connection is IPv6-only): copy the URI. Put your
   password in it, URL-encoding any special characters, and add `?sslmode=require`. That is `DATABASE_URL`.
   Do not use the transaction pooler (port 6543).
4. **Project Settings → API Keys**: copy the **secret** key (`sb_secret_…`). That is `SUPABASE_SECRET_KEY`.
   It stays on Render; never put it in the frontend.
5. The project URL (`https://<ref>.supabase.co`) is `SUPABASE_URL`.

6. **Close the Data API to the app's tables.** Supabase grants its public `anon`/`authenticated` roles access
   to every new table in `public` through its auto-generated REST API, which this app never uses (it talks to
   Postgres directly). Run this once in the SQL editor **before the first deploy**, so the users and sessions
   tables are never reachable with the project's publishable key:

   ```sql
   revoke all on all tables in schema public from anon, authenticated;
   revoke all on all sequences in schema public from anon, authenticated;
   alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
   alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
   alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
   ```

   Turning off **Project Settings → Data API** as well does no harm.

Tables are created by the app on its first start (migrations run on startup).

## 2. Render (API)

1. render.com → **New → Blueprint** → pick this GitHub repo. Render reads `render.yaml`.
2. Fill in the secrets it asks for: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and for now set
   `ASTROPLANNER_CORS` to `https://astroplanner.vercel.app` (fix it after step 3 if Vercel gives another name).
3. Deploy. When it is live, open `https://<service>.onrender.com/api/health`: it should say
   `"status": "ok"` and `"database": "ok"`.
4. If the service URL is not `astroplanner-api.onrender.com`, change the destination in
   `frontend/vercel.json` to match and push.

## 3. Vercel (site)

1. vercel.com → **Add New → Project** → import the repo.
2. **Root Directory: `frontend`**. Framework: Vite (read from `vercel.json`). No environment variables.
3. Deploy. Open the site, then reload directly on `/tonight` (the SPA fallback must serve it).

## 4. Check it

- Create an account and sign in. In devtools → Application → Cookies, the session cookie on the Vercel
  domain is **Secure** and **HttpOnly**.
- Upload a final picture under 4 MB in AstroLog, reload, and the preview is still there (it is in Supabase
  Storage, not on Render's disk).
- GitHub → **Settings → Secrets and variables → Actions → Variables**: add `SITE_URL` =
  `https://astroplanner.vercel.app`, then run **Keep hosted site awake** once from the Actions tab.

### Large-upload check (to raise the 4 MB limit)

Vercel documents a 4.5 MB body limit for Functions but not for rewrites to an external origin. To find out:

1. On Render, set `ASTROPLANNER_MAX_UPLOAD_MB=25` (Render redeploys).
2. Upload a final picture of about 10 MB through the Vercel site.
3. If it works, keep 25 (memory is still bounded by the 2.1 MP pixel limit). If it fails with "That file is
   too large for this server", the proxy has a limit: set it back to 4.

## Known limitations

- **Direct requests to Render.** Anyone who calls `onrender.com` directly, skipping Vercel, can set their own
  `X-Forwarded-For`, so the per-address throttle on failed sign-ups (which slows probing for which emails
  have accounts) can be sidestepped. Sign-in throttling is per account and is not affected. A fix is a
  shared-secret header added by Vercel Routing Middleware and checked by the API.
- **One instance.** Throttles live in memory and reset when Render restarts the service.
- **Licences.** Open-Meteo's free tier is non-commercial; VSX and DSS terms are personal/non-profit. Keep the
  hosted site free, with no ads or paid features.
- Before relying on any number above, recheck the current Render, Vercel and Supabase free-plan pages;
  they change.

## Updating

Push to `main`. Render redeploys the API (`autoDeploy`), and Vercel redeploys the site.
