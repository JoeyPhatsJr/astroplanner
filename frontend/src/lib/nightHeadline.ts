import type { NightClear } from "../api/types";
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
  hasForecast: boolean;
  forecastMessage: string | null;
  tz: string;
}

function within(aIso: string, bIso: string | null): boolean {
  if (!bIso) return false;
  return Math.abs(new Date(aIso).getTime() - new Date(bIso).getTime()) <= EDGE_TOLERANCE_MIN * 60_000;
}

/** Plain-words headline for the night: what the forecast says about clear darkness. */
export function nightHeadline(a: HeadlineInput): { title: string; detail: string } {
  if (!a.hasForecast) {
    return { title: "No forecast yet", detail: a.forecastMessage ?? "The weather forecast is not available for this night." };
  }
  const dark = formatDuration(a.darkMinutes);
  if (!a.clear) {
    return { title: "No forecast-clear darkness", detail: `Cloud or rain is forecast through all ${dark} of darkness.` };
  }
  const detail = `${formatDuration(a.clear.minutes)} of ${dark} of darkness is forecast clear.`;
  const atDusk = within(a.clear.start_utc, a.darkStartUtc);
  const atDawn = within(a.clear.end_utc, a.darkEndUtc);
  if (atDusk && atDawn) return { title: "Clear all night", detail };
  if (atDusk) return { title: `Clear until about ${roundHalfHourLocal(a.clear.end_utc, a.tz)}`, detail };
  if (atDawn) return { title: `Clears around ${roundHalfHourLocal(a.clear.start_utc, a.tz)}`, detail };
  return {
    title: `Clear about ${roundHalfHourLocal(a.clear.start_utc, a.tz)}–${roundHalfHourLocal(a.clear.end_utc, a.tz)}`,
    detail,
  };
}
