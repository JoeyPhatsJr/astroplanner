import { addDays } from "../lib/time";

/**
 * The visitor's browser asks Open-Meteo for the night's forecast itself and hands the answer to the API
 * (`POST /api/forecast/relay`). Open-Meteo's free quota is per IP, and the API's host shares its outbound IP
 * with other services, so asking from the server alone ran the daily quota out for everyone. The API checks
 * the answer and uses it for this browser only; if anything here fails, the API fetches the forecast itself.
 */

export const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
// Must match backend/app/weather.py HOURLY_VARS: the API refuses an answer that lacks any of them.
export const HOURLY_VARS = [
  "cloud_cover",
  "cloud_cover_low",
  "cloud_cover_mid",
  "cloud_cover_high",
  "precipitation_probability",
  "precipitation",
  "relative_humidity_2m",
  "dew_point_2m",
  "temperature_2m",
  "wind_speed_10m",
  "visibility",
] as const;
const DAYS_AHEAD = 15; // Open-Meteo: today + 15 days (UTC)
const DAYS_BEHIND = 92;
/** Re-ask a little before the API forgets a relayed forecast (30 minutes). */
export const RELAY_REFRESH_MS = 25 * 60 * 1000;
const TIMEOUT_MS = 8000;
/**
 * How long a weather request waits for the relay before asking the API anyway. A slow or unreachable
 * Open-Meteo must never hold the page up: the API then answers on its own, and a relay that lands later
 * refreshes the weather (see onLateForecast).
 */
export const RELAY_WAIT_MS = 2500;
const CLIENT_KEY = "astroplanner.forecastClient";

export interface ForecastPlace {
  lat: number;
  lon: number;
  date: string; // local night date, YYYY-MM-DD
  timezone: string;
}

let memoryId: string | null = null;

/** A random id for this browser tab, so the API uses a forecast it relayed for this tab alone. */
export function forecastClientId(): string {
  try {
    const kept = sessionStorage.getItem(CLIENT_KEY);
    if (kept && /^[A-Za-z0-9-]{16,64}$/.test(kept)) return kept;
  } catch {
    // storage blocked: keep the id in memory
  }
  memoryId ??= randomId();
  try {
    sessionStorage.setItem(CLIENT_KEY, memoryId);
  } catch {
    // fine: the id still lasts for this page
  }
  return memoryId;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // not a secret: it only keeps one tab's relayed forecast apart from another's
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

/**
 * Open-Meteo query for a night: the UTC dates around it (a night runs noon to noon local time, so it spans
 * at most the day before to two days after its date in UTC), cut to what Open-Meteo serves. Null when the
 * night is outside that window, where the API answers without a forecast anyway.
 */
export function browserForecastQuery(place: ForecastPlace, now: number = Date.now()): URLSearchParams | null {
  const today = new Date(now).toISOString().slice(0, 10);
  const first = addDays(today, -DAYS_BEHIND);
  const last = addDays(today, DAYS_AHEAD);
  if (place.date >= last || addDays(place.date, 1) < first) return null;
  const start = maxDate(addDays(place.date, -1), first);
  const end = minDate(addDays(place.date, 2), last);
  return new URLSearchParams({
    latitude: place.lat.toFixed(4),
    longitude: place.lon.toFixed(4),
    hourly: HOURLY_VARS.join(","),
    timezone: "GMT",
    timeformat: "unixtime",
    start_date: start,
    end_date: end,
  });
}

const maxDate = (a: string, b: string) => (a > b ? a : b);
const minDate = (a: string, b: string) => (a < b ? a : b);

type Post = (body: string) => Promise<unknown>;

const relays = new Map<string, { at: number; done: Promise<void> }>();
const lateListeners = new Set<() => void>();

export function resetBrowserForecasts(): void {
  relays.clear();
}

/** Called when a relayed forecast was taken after RELAY_WAIT_MS, so answers given without it should refetch. */
export function onLateForecast(listener: () => void): () => void {
  lateListeners.add(listener);
  return () => {
    lateListeners.delete(listener);
  };
}

/** Wait for a relay, but no longer than RELAY_WAIT_MS. */
export function waitForRelay(done: Promise<void>, waitMs = RELAY_WAIT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs);
  });
  return Promise.race([done, timeout]).finally(() => clearTimeout(timer));
}

const used = (answer: unknown) => !!answer && typeof answer === "object" && (answer as { used?: unknown }).used === true;

/**
 * Fetch the night's forecast from Open-Meteo in this browser and hand it to the API with `post`, once per
 * place and night every RELAY_REFRESH_MS. Never throws: on any failure the API fetches the forecast itself.
 */
export function relayBrowserForecast(
  place: ForecastPlace,
  post: Post,
  {
    fetchFn = globalThis.fetch,
    now = Date.now(),
    clock = () => Date.now(),
  }: { fetchFn?: typeof fetch; now?: number; clock?: () => number } = {},
): Promise<void> {
  const key = `${place.lat.toFixed(2)},${place.lon.toFixed(2)},${place.date},${place.timezone}`;
  const kept = relays.get(key);
  if (kept && now - kept.at < RELAY_REFRESH_MS) return kept.done;
  const done = (async () => {
    const query = browserForecastQuery(place, now);
    if (!query || typeof fetchFn !== "function") return;
    const started = clock();
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
    try {
      const res = await fetchFn(`${OPEN_METEO_URL}?${query}`, { signal: ctrl?.signal, credentials: "omit" });
      if (!res.ok) return; // e.g. this browser's own quota: the API tries itself
      const answer = await post(await res.text());
      if (used(answer) && clock() - started > RELAY_WAIT_MS) lateListeners.forEach((l) => l());
    } catch {
      // offline, blocked or slow: the API tries itself
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
  relays.set(key, { at: now, done });
  return done;
}
