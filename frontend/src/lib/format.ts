// Coordinate and value formatting.

const MINUS = "−";

/** Right ascension in degrees -> "05h 35m 16.5s". */
export function formatRA(deg: number): string {
  let totalSec = (((deg % 360) + 360) % 360) / 15 * 3600;
  totalSec = Math.round(totalSec * 10) / 10;
  if (totalSec >= 86400) totalSec -= 86400;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec - h * 3600) / 60);
  const s = totalSec - h * 3600 - m * 60;
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${s.toFixed(1).padStart(4, "0")}s`;
}

/** Declination in degrees -> "+41° 16′ 09″" (typographic minus for negatives). */
export function formatDec(deg: number): string {
  const sign = deg < 0 ? MINUS : "+";
  let totalSec = Math.round(Math.abs(deg) * 3600);
  const d = Math.floor(totalSec / 3600);
  totalSec -= d * 3600;
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  return `${sign}${String(d).padStart(2, "0")}° ${String(m).padStart(2, "0")}′ ${String(s).padStart(2, "0")}″`;
}

export function formatDeg(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  const v = x.toFixed(digits);
  return `${v.startsWith("-") ? MINUS + v.slice(1) : v}°`;
}

export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

export function formatSize(major: number | null, minor: number | null): string {
  if (!major) return "Not listed";
  const f = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1));
  return minor ? `${f(major)}′ × ${f(minor)}′` : `${f(major)}′`;
}

export function formatPct(x: number | null | undefined): string {
  return x === null || x === undefined ? "–" : `${Math.round(x)}%`;
}

export function formatPoints(x: number | null | undefined): string {
  return x === null || x === undefined ? "–" : x.toFixed(1);
}

export const CATEGORY_LABEL: Record<string, string> = {
  all: "All types",
  galaxy: "Galaxies",
  nebula: "Nebulae",
  cluster: "Clusters",
};
