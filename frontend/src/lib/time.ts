// Time helpers. Every observer-facing time is formatted in the observing
// location's IANA timezone, never the browser's.

export type Instant = string | number | Date;

function toDate(x: Instant): Date {
  return x instanceof Date ? x : new Date(x);
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

/** "21:43" in the given timezone (24 h). */
export function formatTime(x: Instant, tz: string): string {
  return fmt(tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(toDate(x));
}

/** Short zone name at that instant, e.g. "EST" / "EDT" / "GMT+10". */
export function tzAbbrev(x: Instant, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(toDate(x));
  return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
}

/** "21:43 EST" */
export function formatTimeTz(x: Instant, tz: string): string {
  return `${formatTime(x, tz)} ${tzAbbrev(x, tz)}`;
}

/** "Mon 2 Nov, 21:43" in tz. */
export function formatDateTime(x: Instant, tz: string): string {
  const d = toDate(x);
  const day = fmt(tz, { weekday: "short", day: "numeric", month: "short" }).format(d);
  return `${day.replace(",", "")}, ${formatTime(d, tz)}`;
}

/** Calendar date (YYYY-MM-DD) of an instant in tz. */
export function localDate(x: Instant, tz: string): string {
  const parts = fmt(tz, { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(toDate(x));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Local hour (0-23) of an instant in tz. */
export function localHour(x: Instant, tz: string): number {
  const h = fmt(tz, { hour: "2-digit", hourCycle: "h23" }).format(toDate(x));
  return Number.parseInt(h, 10);
}

/** Add whole days to a YYYY-MM-DD string (pure calendar arithmetic). */
export function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** "Mon 2 Nov" for a calendar date string (no timezone shift). */
export function formatCalendarDate(isoDate: string, withYear = false): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const s = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(dt);
  return s.replace(",", "");
}

/** "Night of Mon 2 Nov → morning of Tue 3 Nov" */
export function nightLabel(isoDate: string): string {
  return `Night of ${formatCalendarDate(isoDate)} → morning of ${formatCalendarDate(addDays(isoDate, 1))}`;
}

export const NIGHT_ROLLOVER_HOUR = 6;

/**
 * The night a user most likely means right now at a location. Before 06:00
 * local time you are still inside the previous evening's night, so the default
 * is yesterday's date.
 */
export function defaultNightDate(now: Instant, tz: string, rolloverHour = NIGHT_ROLLOVER_HOUR): string {
  const today = localDate(now, tz);
  return localHour(now, tz) < rolloverHour ? addDays(today, -1) : today;
}

/** "5 h 04 min" / "45 min" */
export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")} min` : `${h} h`;
}

/** "12 min ago" relative to now (for data-age labels). */
export function formatAge(x: Instant, now: Instant = Date.now()): string {
  const s = Math.round((toDate(now).getTime() - toDate(x).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function isoToMs(iso: string | null | undefined): number | null {
  return iso ? new Date(iso).getTime() : null;
}
