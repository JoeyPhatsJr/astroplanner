import type { Darkness, HourlyRow, NightClear, NightSummary, TonightScore } from "../api/types";
import { formatDuration, formatTime } from "./time";

/** A run within this many minutes of dusk or dawn counts as touching it. */
const EDGE_TOLERANCE_MIN = 6;

/**
 * Local clock time rounded to the nearest half hour, in the observer's zone.
 * Rounds the local wall-clock minutes (not the UTC instant) so zones with
 * 45-minute offsets still land on :00 or :30.
 */
export function roundHalfHourLocal(iso: string, tz: string): string {
  const [h, m] = formatTime(iso, tz).split(":").map(Number);
  const rounded = Math.round((h * 60 + m) / 30) * 30;
  const wrapped = rounded % (24 * 60);
  const hh = Math.floor(wrapped / 60);
  const mm = wrapped % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export interface HeadlineInput {
  clear: NightClear | null;
  darkMinutes: number;
  darkStartUtc: string | null;
  darkEndUtc: string | null;
  hasDarkness: boolean;
  darkness: Darkness;
  /** The forecast request itself succeeded. */
  hasForecast: boolean;
  /** Tonight's Score status: tells whether the forecast has usable values during darkness. */
  scoreStatus: TonightScore["status"];
  /** Minutes of darkness with no usable forecast value (from {@link darkForecastGaps}). */
  missingDarkMinutes: number;
  /** The clear run ends where the forecast stops, not where cloud or rain arrives. */
  clearEndsAtMissing: boolean;
  forecastMessage: string | null;
  tz: string;
}

/** Same rule as the server's grid alignment: the nearest hour within 30 minutes, ties to the earlier hour. */
const MAX_GAP_MS = 30 * 60_000;

function usableAt(t: number, rows: HourlyRow[]): boolean {
  let best: HourlyRow | null = null;
  let bestGap = Infinity;
  for (const r of rows) {
    const gap = Math.abs(r.t_ms - t);
    if (gap < bestGap) {
      best = r;
      bestGap = gap;
    }
  }
  return !!best && bestGap <= MAX_GAP_MS && best.cloud_cover !== null && best.precipitation_probability !== null;
}

/**
 * Where darkness has no usable forecast, on the night's own sample grid.
 * Mirrors the server, which counts a sample as forecast only when both cloud and rain chance are present.
 */
export function darkForecastGaps(
  night: Pick<NightSummary, "series" | "darkness_threshold_deg">,
  hourly: HourlyRow[],
  clear: NightClear | null,
): { missingDarkMinutes: number; clearEndsAtMissing: boolean } {
  const { t_ms, sun_alt_deg } = night.series;
  const rows = [...hourly].sort((a, b) => a.t_ms - b.t_ms);
  const stepMin = t_ms.length > 1 ? (t_ms[1] - t_ms[0]) / 60_000 : 0;
  const dark = (i: number) => sun_alt_deg[i] < night.darkness_threshold_deg;
  let missing = 0;
  for (let i = 0; i < t_ms.length; i++) if (dark(i) && !usableAt(t_ms[i], rows)) missing += stepMin;
  let clearEndsAtMissing = false;
  if (clear) {
    const end = Date.parse(clear.end_utc);
    const next = t_ms.findIndex((t) => t >= end - 1000);
    clearEndsAtMissing = next >= 0 && dark(next) && !usableAt(t_ms[next], rows);
  }
  return { missingDarkMinutes: Math.round(missing), clearEndsAtMissing };
}

function within(aIso: string, bIso: string | null): boolean {
  if (!bIso) return false;
  return Math.abs(new Date(aIso).getTime() - new Date(bIso).getTime()) <= EDGE_TOLERANCE_MIN * 60_000;
}

/**
 * Plain-words headline for the night: what the forecast says about clear darkness.
 * It never claims cloud where there is no darkness or no forecast value.
 */
export function nightHeadline(a: HeadlineInput): { title: string; detail: string } {
  if (!a.hasDarkness) {
    return {
      title: "No darkness on this night",
      detail: `The Sun stays too high for ${a.darkness} darkness, so there are no dark hours to forecast.`,
    };
  }
  if (!a.hasForecast) {
    return { title: "No forecast yet", detail: a.forecastMessage ?? "The weather forecast is not available for this night." };
  }
  if (a.scoreStatus === "no_weather") {
    return { title: "No forecast yet", detail: "The forecast has no cloud or rain values for this night's darkness yet." };
  }
  const dark = formatDuration(a.darkMinutes);
  const partial = a.scoreStatus === "partial_weather";
  const gap = a.missingDarkMinutes > 0 ? formatDuration(a.missingDarkMinutes) : null;
  if (!a.clear) {
    if (partial) {
      const rest = gap ? `${gap} of the ${dark} of darkness has no forecast.` : "Some dark hours have no forecast.";
      return { title: "No forecast-clear darkness", detail: `Cloud or rain is forecast wherever the forecast reaches. ${rest}` };
    }
    return { title: "No forecast-clear darkness", detail: `Cloud or rain is forecast through all ${dark} of darkness.` };
  }
  let detail = `${formatDuration(a.clear.minutes)} of ${dark} of darkness is forecast clear.`;
  if (partial) detail += gap ? ` ${gap} of it has no forecast.` : " Some dark hours have no forecast.";
  const from = roundHalfHourLocal(a.clear.start_utc, a.tz);
  const until = roundHalfHourLocal(a.clear.end_utc, a.tz);
  const atDusk = within(a.clear.start_utc, a.darkStartUtc);
  const atDawn = within(a.clear.end_utc, a.darkEndUtc);
  if (a.clearEndsAtMissing) {
    const title = atDusk ? `Forecast clear until about ${until}; no forecast after` : `Forecast clear about ${from}–${until}; no forecast after`;
    return { title, detail };
  }
  if (atDusk && atDawn) return { title: "Clear all night", detail };
  if (atDusk) return { title: `Clear until about ${until}`, detail };
  if (atDawn) return { title: `Clears around ${from}`, detail };
  return { title: `Clear about ${from}–${until}`, detail };
}
