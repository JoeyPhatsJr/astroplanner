# Astronomy methods and verification

All positions are computed on the backend with **Astropy 8** (`get_body`,
`SkyCoord`, `AltAz`). Nothing astronomical is computed in the browser.

## Conventions

| Topic | Rule |
|---|---|
| Night date | "Night of D" = local **noon on D → noon on D+1** in the observer's IANA timezone, built with `zoneinfo` and converted to UTC. DST nights are therefore 23 h or 25 h long. |
| Time base | UTC internally, 5-minute grid; display in the observer's timezone. |
| Altitudes | Geometric (no refraction, `pressure=0`), topocentric. |
| Sunrise/sunset, moonrise/moonset | Centre of the disc at **−0.833°** (34′ refraction + ~16′ semi-diameter), same as USNO. |
| Twilight | Sun centre altitude: civil −6°, nautical −12°, **astronomical −18°**. |
| Darkness setting | Astronomical (−18°, default) or nautical (−12°) for high-latitude summers. |
| Boundaries | Linear interpolation between the two samples straddling a threshold. |
| Moon illumination | Meeus ch. 48 phase-angle formula from Astropy geocentric Sun/Moon positions. |
| Moon–target separation | Topocentric, computed from both objects' alt/az at each sample. |
| Earth orientation | IERS tables bundled with `astropy-iers-data` (no downloads at request time). Outside the table range Astropy uses degraded values (arcsecond-level, irrelevant for planning). |
| Target coordinates | OpenNGC J2000 (ICRS) catalog positions. For very large nebulae the catalog position may not be the visual centre. |

## Target visibility rules

A target is **observable** only if there is a contiguous interval of at least
30 minutes during which **both** the Sun is below the darkness threshold **and**
the target is at or above the minimum altitude (default 30°, a heuristic, not a
physical boundary). Other statuses are reported with an explanation:

- `never_rises` — declination keeps it below the horizon at this latitude
- `below_threshold` — never reaches the minimum altitude
- `daylight_only` — above the minimum altitude only while the sky is not dark
- `too_brief` — window shorter than 30 minutes
- `no_darkness` — the Sun never reaches the darkness threshold (e.g. midnight sun)

## Verification (automated, `backend/tests/test_reference_astronomy.py`)

Reference values were fetched on 2026-11-02 from the U.S. Naval Observatory
Astronomical Applications API (`/api/rstt/oneday`, `/api/moon/phases/date`) and
stored in `backend/tests/reference_data.py` with their URLs.

| Case | Checks | Tolerance | Result |
|---|---|---|---|
| Philadelphia, night of 2026-11-01 (EST) | sunset, civil dusk, civil dawn, sunrise, moonrise | 1.5 min (USNO rounds to the minute) | pass |
| Philadelphia, night of 2026-10-31 (EDT evening → EST morning, 25 h) | same | 1.5 min | pass |
| Philadelphia, night of 2026-03-07 (EST evening → EDT morning, 23 h) | same | 1.5 min | pass |
| Sydney, night of 2026-06-21 (southern winter) | sun events, moonset | 1.5 min | pass |
| Tromsø, 2026-06-21 (midnight sun) | no darkness, no sunset/sunrise, lowest Sun at USNO lower transit | 5 min | pass |
| USNO primary Moon phases Oct–Nov 2026 | illumination < 0.5% at new, > 99.5% at full, 50 ± 1% at quarters, waxing flag | as stated | pass |
| Meeus Example 13.b (Venus, Washington DC, 1987-04-10 19:21 UT) | altitude 15.1249°, azimuth 68.0337° from south | 0.01° | pass |
| Polaris from 40° N | altitude within 0.8° of latitude all night | 0.8° | pass |

Spot comparison (night of 2026-11-01, Philadelphia), ours vs USNO:
sunset 16:58:12 vs 16:58 · civil dusk 17:26:17 vs 17:26 · sunrise 06:30:54 vs
06:31 · moonset 13:09:45 vs 13:10 · moonrise 23:20:40 vs 23:21.

Further behavioural tests (`test_night_and_visibility.py`) cover DST span
lengths, winter vs summer darkness, nautical-only nights, polar night, never-
rising and circumpolar targets, a target that is high only in daylight (M1 in
June), and that every reported window lies entirely in darkness above the
minimum altitude.

## Known limitations

- No atmospheric refraction in altitudes (≈1.7′ at 30°; negligible for planning).
- No local horizon/obstruction model (planned "SkyTwin" concept).
- Planets, comets and the Moon as a target are not in the Phase 1 catalog.
- Magnitude is integrated catalog magnitude and is never used as an imaging-difficulty score.
