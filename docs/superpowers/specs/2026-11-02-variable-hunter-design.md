# Phase 3 design: Variable Hunter

_Status: builder-checked, awaiting developer review · 2026-11-02 · follows ROADMAP.md steps 1–5_
_Brainstormed with the developer. The developer decided the purpose, the light curve as the centrepiece,
the alert style (option B) and approved the star-page mockup; they handed the star list, mission rules and
history depth to Claude. Items marked **(Claude's call)** were not decided by the developer and may be
changed by the builder if they find a better option._

## 1. Intent

The developer read about a star that suddenly got brighter and wants to follow such stars themself with their
Seestar S30. The work is meant to show real data handled carefully (it will support an aerospace college
application), so the finished screen is a **light curve of a real variable star with the developer's own
observing nights on it**, next to the AAVSO community's data, with sources, counts and freshness visible.

Phase 3 delivers following and planning: real AAVSO light curves, "it got brighter" alerts, when each star is
observable, and missions counted from the developer's own AstroLog imports. **Measuring brightness from the
developer's images (photometry) and submitting to AAVSO are Phase 4**; Phase 3 leaves a labelled slot for them.

## 2. What we know (recon on 2026-11-02, recorded so the builder need not repeat it)

- **T CrB has not erupted** (no nova reported as of October 2026; several predicted dates have lapsed). Pei et al.
  (MNRAS 2026) give ~30 % for the rest of 2026 and ~57 % within a year, explicitly "not physical predictions".
- **AAVSO access actually tested** (plain requests, default user agent):
  - `https://vsx.aavso.org/index.php?view=api.object&ident=T%20CrB&format=json` → 200 JSON
    `{"VSXObject":{"Name","AUID","RA2000","Declination2000","VariabilityType","Period","Epoch","MaxMag","MinMag",
    "SpectralType","Constellation","OID",…}}` (values are strings, e.g. `"MaxMag":"2.0 V"`).
  - `https://vsx.aavso.org/index.php?view=api.delim&ident=SS%20Cyg&fromjd=<jd>&tojd=<jd>&delimiter=,` → 200 CSV
    with header `JD,mag,uncert,band,by,comCode,compStar1,compStar2,charts,comment,transformed,airmass,val,cmag,kmag,
    starName,obsAffil,mtype,adsRef,digitizer,credit,obsID,fainterThan,obsType,software,obsName,obsCountry`.
    `by` is the observer code, `obsName`/`obsCountry` are the observer's **full name and country**.
  - Volume: SS Cyg returned **16,626 observations for 150 days in 19 s**; T CrB ~350 observations per day.
  - `www.aavso.org` (docs, guidelines, the VSX mirror) sits behind a Cloudflare browser challenge and returns 403
    to automated clients. The app must use `vsx.aavso.org` only and must not try to get past the challenge.
- **AAVSO Data Usage Guidelines (Oct 2025 revision) exist** (acknowledgement text, facility keyword "AAVSO (AID)",
  observers as co-authors when data are critical to research, "data are and always will be provided free of
  charge"), but their full text and the official VSX API documentation **have not been read yet**: see §8, gate G1.
- **Visibility from the sample location (Philadelphia, 40° N)**, using the app's own conventions (5-min grid,
  Sun < −18°, Astropy): T CrB stays below 30° in darkness until about January and is excellent February–June;
  SS Cyg is high now and is lost around February; U Gem and R Leo are well placed December–April.
- **Seestar S30 brightness limits are unknown.** The only data point is one S50 owner (saturation near mag 8,
  limit 13–14 for 4-minute stacks); scaled to 30 mm that suggests roughly **7 to 12.5**. This is an unverified
  estimate and must always be shown as one.
- Real SS Cyg data for the last 150 days shows four outbursts (≈12 → 8.5–9 V, fading over 1–2 weeks).

## 3. Goals

1. **Variable Hunter section** (replaces the Research Lab preview) listing a curated set of four stars.
2. **Star page** (as in the approved mockup): name, type, VSX range, status chip, a light curve of real AAVSO
   observations (brighter is up), source/count/fetch-time line, tonight's window above the minimum altitude from
   the selected location, the developer's nights as markers, mission cards, a "Seestar fit" note, a short
   "how brightness is measured" explainer with AAVSO links, and a labelled Phase 4 slot.
3. **Sky alerts (developer's choice: option B)**: a card on Tonight listing watched stars with a notable change,
   plus a dot on the Variable Hunter menu item visible from every page. Each alert shows the star, its current
   brightness vs. its normal level, whether it is up tonight, the evidence ("3 observers brighter than 10.0 in
   the last 48 h") and data freshness ("AAVSO, checked 2 h ago"). Shown when the app is opened; no push or email.
4. **Missions counted only from AstroLog imports**: a night counts when it has frames of that star.
5. **Add to plan**: a variable star can be added to a session plan from its page, like a catalog target.
6. **T CrB 1946 window**: T CrB's page can also show AAVSO data around its February 1946 eruption, so the
   previous eruption sits next to today's curve.

## 4. Non-goals (Phase 3)

- Photometry from the developer's images, comparison-star selection, AAVSO submission (Phase 4).
- Eclipse timetables, eruption dates or any other prediction (no ephemeris validation in this phase).
- Adding arbitrary stars; editing the curated list in the UI.
- Push, email or OS notifications; background polling while the app is closed.
- Changes to Phase 1 DSO scoring or recommendations (variable stars are not mixed into the DSO ranking).

## 5. Anti-goals (would make it a failure even if it works)

- Any simulated, interpolated-as-data or placeholder light curve presented as observations.
- An alert raised by a single observation, or "no change" shown when the data is stale or unreachable.
- A countdown or "expected on" date for T CrB.
- Showing, storing or logging observer names or countries.
- Hammering AAVSO: repeated full-history downloads, parallel bursts, or getting past their Cloudflare challenge.
- Claiming a star is "within the Seestar's range" as fact.

## 6. Constraints

- All CLAUDE.md non-negotiables and ROADMAP standing rules apply (real data with source and update time,
  explicit missing-data states, no dead buttons, no claimed tests that were not run).
- Spec §Phase 1.2: real AAVSO light-curve data **only where authorized and technically feasible**; otherwise link
  to the official AAVSO data view. Spec §Variable stars: do not assume an unrestricted real-time JSON API.
- Keep the `DATABASE_URL` seam (SQLite + Postgres), Alembic migrations hand-written, Phase 1 + 2 suites green.
- Tests never call AAVSO; the provider is injected via `app.state` (like `app.state.weather`) and stubbed.
  Committed fixtures are **synthetic**, shaped exactly like the observed VSX responses (§2 column list), with
  planted fake observer names/countries as canaries. Real AAVSO observations are not committed to the public repo
  unless G1 shows redistribution is allowed; real-data checks run locally only (criterion 10).
- Privacy rules from Phase 2 stay (no header coordinates stored or returned).

## 7. Decisions

### 7.1 Curated stars (Claude's call; seasons from §2)

| id | Star | Why | Alert rule (normal level → alert threshold) |
|---|---|---|---|
| `ss-cyg` | SS Cyg, dwarf nova | Flares ~monthly; best now (autumn) | quiet ≈ 12 V → brighter than 10.0 |
| `u-gem` | U Gem, dwarf nova | Winter; outbursts reach ≈ 8–9 | quiet ≈ 14.5 V → brighter than 11.0 |
| `r-leo` | R Leo, Mira variable | Slow ~312-day cycle, winter–spring | no outburst alert; page shows the trend only |
| `t-crb` | T CrB, recurrent nova | The headline star; spring onward | normal ≈ 10 V → brighter than 8.0 |

Identity, coordinates, type, period and range come from VSX `api.object` at build time (stored with the source
and retrieval date, the same provenance rule as `targets.json`). Thresholds are curated values written in the
data file with a one-line justification each. The "normal level" text is derived from data the app shows, not
invented: if it can't be computed, the alert shows only the threshold.

### 7.2 Alert rule (Claude's call)

An alert is raised when, in the cached observations from the last **48 h**, at least **2 distinct observers**
(T CrB: **3**) report the star brighter than its threshold, counting only positive detections
(`fainterThan = 0`) in V or visual bands. "Distinct observer" uses an opaque hash of the observer code, which is
never shown (Claude's call; revisit after G1 if the guidelines say otherwise). The alert text quotes the count,
the threshold, the window and the fetch time. States: `alert`, `no change`, `stale` (no fetch in 24 h or last
fetch failed: says so with the last successful time), `unavailable` (never fetched). Dismissing an alert hides
that star's alert until it returns to normal and alerts again (store the dismissal, not a timer).

### 7.3 AAVSO data access and cache (Claude's call)

- One provider module behind an interface (`fetch_object(ident)`, `fetch_observations(ident, from_jd, to_jd)`),
  injected via `app.state`. HTTP via `httpx`, honest user agent naming the app and the public repo URL.
- Keep only: JD, magnitude, uncertainty, band, fainterThan, obsType, validation flag, observer-code hash.
  Never persist `obsName`, `obsCountry`, comments or chart IDs.
- Cache in the database (works on SQLite and Postgres). Two separate fetch paths (Claude's call, after builder check):
  - **Alert path:** when the app is opened (Tonight or any page that shows the menu dot), fetch only the **last
    3 days** for each alerting star (SS Cyg, U Gem, T CrB), at most once per star per 6 h. This is small (T CrB
    ≈ 1,000 rows) and does not depend on the history being loaded.
  - **History path:** when a star page is opened, fill the 365-day history in date chunks (e.g. 30 days) in the
    background with visible progress, then refresh incrementally from the last cached JD at most once per 6 h.
    The page shows whatever is cached while it loads.
  - All requests are sequential, ≥ 2 s apart, across both paths.
- History depth: last **365 days** by default. T CrB additionally caches a fixed 1946 window around the eruption
  (builder computes the JD range from the published eruption date and records the source).
- The light curve draws daily averages as a line plus a down-sampled scatter of individual points, both labelled
  ("daily average", "individual observations (every Nth shown)"). Visual and V are distinguishable.

### 7.4 Missions (Claude's call)

Defined per star in the curated data file; progress is computed, never entered:

| Star | Mission | Counts when |
|---|---|---|
| SS Cyg, U Gem | **Catch an outburst**: 3 nights during one outburst | nights with frames of the star that fall inside an outburst window derived from the cached AAVSO daily averages (brighter than threshold) |
| all four | **Weekly watch**: streak of consecutive weeks with ≥ 1 night | ISO weeks in the observer's timezone with a night of frames |
| R Leo | **Follow the cycle**: one night a month for 6 months | calendar months with a night of frames |

A "night of frames" is an AstroLog capture set whose library target resolves to the star. Linking
(Claude's call, after builder check; Phase 2 today can only rename a custom target or merge it into Unsorted):

- **New imports:** `resolve_target` also knows the curated names and aliases (e.g. "SS Cyg", "SS Cygni") and
  creates the library target with `catalog_target_id = "var:ss-cyg"` (new kind `variable`), so Phase 2's existing
  plan attach, badge and "not shot" logic, which key on `catalog_target_id` + the shared lookup, work for it.
- **Targets imported before Phase 3** (custom targets whose name happens to match): never changed automatically.
  The target page offers an explicit, user-initiated **"This is SS Cyg"** action that converts that one custom
  target (whole target, not per set), the same kind of user edit as Phase 2's rename. If a `variable` target for
  that star already exists, the action merges into it, following Phase 2's Unsorted-merge pattern.
- No per-capture-set move in Phase 3 (still the "possible later addition" in the ROADMAP decision log).

**Under the G1 fallback** "Catch an outburst" is not shown (it needs AAVSO data); weekly watch and follow the
cycle still work, because they count only the developer's own nights.

### 7.5 Visibility and plans

- Generalize the visibility engine so a night's sky context can take an explicit coordinate list (the seam named
  in ROADMAP.md) instead of only the 58-target catalog; Phase 1 results must not change (existing tests prove it).
- Variable stars resolve through the same target lookup used by session plans, with ids that cannot collide with
  catalog ids (e.g. `var:ss-cyg`), so "Add to plan" and AstroLog plan matching work unchanged.

### 7.6 UI

- The "Research Lab" nav item becomes **"Variable Hunter"**; `/research` redirects to the new route (Claude's call).
- Layout and copy follow the approved mockup (`.superpowers/brainstorm/…/variable-hunter.html`, not committed;
  screenshot to be committed under `docs/screenshots/` once built). Clean Planetarium theme and night-vision mode
  apply to the chart.
- "Seestar fit" note per star: compares the VSX range with the **estimated** S30 range from §2, worded as an
  estimate (e.g. "Near maximum R Leo is probably too bright for the S30 (estimate, not yet measured)").
- Explainer: a short section on what a light curve is, why brighter is up, comparison stars, saturation and
  uncertainty, linking to AAVSO pages (spec requires this education).

## 8. Gates and risks

- **G1 (blocking, before any AAVSO code is merged): read the official terms.** The developer supplies the AAVSO
  Data Usage Guidelines and the VSX API documentation (saved from a browser; not committed). If they permit
  displaying AID observations in a third-party app with attribution and programmatic VSX access: build §7.3 and
  copy their required acknowledgement text verbatim into the UI and README. If they do not, or are silent on
  automated access: **fallback**: no observation download; star pages show VSX catalog facts, visibility, missions
  and the developer's nights, and link to AAVSO's own light-curve view; alerts are not built. Record the outcome
  in the ROADMAP decision log.
  **Build order so G1 blocks as little as possible (Claude's call):** the parts that need no AAVSO observations
  come first (curated star data from VSX catalog facts, visibility seam, star page shell, plans, AstroLog linking,
  weekly/cycle missions, explainer, nav rename); the AAVSO provider, cache, light curve, alerts and "catch an
  outburst" come last, after G1 is settled.
- **Volume / speed**: T CrB's last year may be ~100k rows and minutes to fetch. Chunking and caching must keep the
  page usable (show cached data and progress). The builder should verify whether `api.delim` supports band filters
  or limits, using the official docs from G1.
- **Validation flags**: the meaning of `val` codes (e.g. `Z`, `V`) must be taken from the docs; until then do not
  filter on them silently. Say in the UI which observations are included.
- **Discordant data**: visual estimates scatter by ~0.5 mag; the 2-observer rule and daily averages limit, but do
  not remove, false alerts. The alert text must show its evidence so the developer can judge.
- **Name matching**: Seestar's `OBJECT` header for a variable star is whatever the developer typed or picked;
  unmatched names fall back to manual linking (Phase 2's custom targets).
- **S30 limits**: unknown until Phase 4 measures saturation in the developer's own frames.

## 9. Acceptance criteria

1. With the provider stubbed by synthetic VSX-shaped responses, each star page renders a light curve whose
   plotted points equal the fixture's positive V/visual detections, with the source line showing count and fetch time.
2. Alert rule unit tests: 1 observer bright → no alert; 2 distinct observers within 48 h → alert (T CrB needs 3);
   bright but older than 48 h → no alert; `fainterThan` rows ignored; last fetch > 24 h ago → `stale`, never "no change".
3. No response, database row or log line contains an observer name or country (tests plant sentinel names in the
   synthetic fixture and assert they never come out).
4. Incremental refresh: a second page view within 6 h makes no HTTP request; after 6 h it requests only from the
   last cached JD. Opening the app fetches only the 3-day alert window, never history.
5. Missions: synthetic AstroLog nights produce the expected outburst count, weekly streak and monthly count;
   a night outside an outburst window does not count toward "catch an outburst".
6. Visibility for a variable star matches an independent Astropy calculation for the same coordinates and night
   within 0.1°; all Phase 1 visibility and reference tests unchanged.
7. A variable star can be added to a plan, survives reload, and an AstroLog import of frames named "SS Cyg" on
   that night attaches to the plan.
8. Tonight shows the Sky alerts card and the menu dot when an alert exists, and an explicit stale/unavailable
   state when AAVSO data is missing; e2e covers both (stubbed provider).
9. G1 outcome recorded; if the fallback applies, criteria 1, 2 and 4 are replaced by "star page links to AAVSO's
   light-curve view and shows no observation data".
10. Local live check (not CI): with the real provider, SS Cyg's page loads the last 365 days and the curve matches
    the shape seen in recon (outbursts to ≈ 8.5–9 V).
11. Docs: README, ARCHITECTURE, PROGRESS, ROADMAP updated; attribution and acknowledgement text shown in the UI.

## 10. Left to the builder

Table and module names, chart library details (Recharts is already used), exact chunk size, the down-sampling
method, explainer wording (sourced), how the 1946 window is presented (tab vs. second chart), and mobile layout,
within the constraints above.
