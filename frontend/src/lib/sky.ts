import type { HourlyRow } from "../api/types";

export type SkyBand = "day" | "civil" | "nautical" | "astronomical" | "dark";

export const BAND_LABEL: Record<SkyBand, string> = {
  day: "Daylight",
  civil: "Civil twilight",
  nautical: "Nautical twilight",
  astronomical: "Astronomical twilight",
  dark: "Astronomical darkness",
};

export const BAND_FILL: Record<SkyBand, string> = {
  day: "#33507a",
  civil: "#26406a",
  nautical: "#1b3050",
  astronomical: "#13223d",
  dark: "#0b1426",
};

/** Same thresholds as the backend: sunrise −0.833°, civil −6°, nautical −12°, astronomical −18°. */
export function skyBand(sunAltDeg: number): SkyBand {
  if (sunAltDeg > -0.833) return "day";
  if (sunAltDeg > -6) return "civil";
  if (sunAltDeg > -12) return "nautical";
  if (sunAltDeg > -18) return "astronomical";
  return "dark";
}

export interface BandSegment {
  band: SkyBand;
  start: number;
  end: number;
}

/** Contiguous segments of identical sky band; boundaries at sample midpoints. */
export function bandSegments(tMs: number[], sunAlt: number[], from?: number, to?: number): BandSegment[] {
  const out: BandSegment[] = [];
  for (let i = 0; i < tMs.length; i++) {
    const t = tMs[i];
    if ((from !== undefined && t < from) || (to !== undefined && t > to)) continue;
    const b = skyBand(sunAlt[i]);
    const last = out[out.length - 1];
    if (last && last.band === b) {
      last.end = t;
    } else {
      const start = last ? (last.end + t) / 2 : t;
      if (last) last.end = start;
      out.push({ band: b, start, end: t });
    }
  }
  if (out.length && from !== undefined) out[0].start = Math.max(from, out[0].start);
  return out;
}

/** Nearest hourly forecast row within 30 minutes of t, else null (missing, never filled). */
export function nearestHour(rows: HourlyRow[], t: number): HourlyRow | null {
  let best: HourlyRow | null = null;
  let bestGap = Infinity;
  for (const r of rows) {
    const gap = Math.abs(r.t_ms - t);
    if (gap < bestGap) {
      bestGap = gap;
      best = r;
    }
  }
  return bestGap <= 30 * 60_000 ? best : null;
}
