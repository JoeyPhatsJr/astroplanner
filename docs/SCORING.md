# Scores (heuristic planning estimates)

Both scores are **documented heuristics**. They are not measurements of sky
quality, transparency or seeing, and the UI labels them that way. Every
component reports its points, its maximum, whether it is based on **forecast**
or **calculated** data, and a plain-language detail. Code: `backend/app/scoring.py`;
tests: `backend/tests/test_scoring.py`.

## Tonight's Score (0–100)

Per 5-minute sample during darkness (hourly forecast values applied to the
nearest hour, never interpolated or filled):

| Component | Points | Formula | Basis |
|---|---|---|---|
| Cloud cover | 45 | `45 × (1 − cloud% / 100)` | forecast |
| Rain risk | 25 | `25 × (1 − precipitation probability / 100)` | forecast |
| Moonlight | 20 | `20 × (1 − illuminated fraction)` while the Moon is up; 20 while it is down | calculated |
| Darkness available | 10 | `10 × min(dark minutes / 360, 1)` | calculated |

Summary method: find the **best contiguous 2-hour window of darkness** (highest
mean of cloud + rain + Moon), average the three components over it, then add the
darkness component. If the night has less than 2 hours of darkness, the whole
dark interval is used.

Honesty rules:

- **No forecast → no total.** Status `no_weather`; only the calculated Moon and
  darkness indicators are shown, explicitly as a partial (out of 30).
- Hours with missing forecast values are excluded from the window search
  (status `partial_weather`); nulls are never treated as clear skies.
- **No darkness → no total** (status `no_darkness`), with an explanation and a
  suggestion to switch to nautical darkness where it applies.
- A 0% precipitation probability is labelled as not a guarantee of dry skies.
- Meteorological visibility is fetched but not scored; it is not seeing or transparency.

## Target recommendation score (0–100)

Only targets with an observable window (≥ 30 min, dark, above the minimum
altitude) are scored. Computed over the target's longest window:

| Component | Points | Formula | Basis |
|---|---|---|---|
| Altitude | 30 | `30 × clip((2.5 − median airmass) / 1.5, 0, 1)` (30 at zenith, 10 at 30°) | calculated |
| Imaging time | 25 | `25 × min(window minutes / 240, 1)` | calculated |
| Moon interference | 20 | `20 × (1 − mean(illum × g(sep)) × sensitivity)` while the Moon is up; `g = clip((120 − sep)/100, 0.2, 1)`; sensitivity 0.5 for emission-line targets, 1.0 otherwise | calculated |
| Forecast weather | 25 | `25 × mean(0.7 × (1 − cloud) + 0.3 × (1 − precip))` | forecast |

If the forecast is unavailable for the window, the weather component is
excluded and the score is shown **out of 75**, not rescaled to look like 100.

**Forecast-favorable window:** the longest part of the observable window where
cloud ≤ 40% and precipitation probability ≤ 30%.

**Equipment fit** (e.g. "exceeds the ~148′ field") is an advisory note only and
never changes the score, because the Seestar S30's published 2.46° FOV does not
state whether it is horizontal, vertical or diagonal.

**Reasons and cautions:** each recommendation lists 2–4 "why" bullets
(window length and times, peak altitude, Moon state, favorable forecast) and up
to 4 cautions (framing, short window, nearby Moon, heavy cloud, no forecast).

## Changing weights

Weights are module-level constants (`TONIGHT_WEIGHTS`, `TARGET_WEIGHTS`) and are
exposed at `GET /api/about`. Tests check that components stay bounded and sum to
the total, so a weight change that breaks normalization fails CI.
