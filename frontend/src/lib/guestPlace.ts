import type { LocationInput, ObservingLocation } from "../api/types";

/**
 * A place kept only in this browser (in the saved preferences), for visitors without an account.
 *
 * Saved places are private to an account, so a signed-out visitor's place is never sent to the server as a row.
 * Planning needs only its coordinates and timezone, which every planning request carries anyway. Anything that
 * needs a server row (plans, the AstroLog import) never sees the guest id: see `serverLocationId`.
 */
export type GuestPlace = LocationInput;

/** The id the guest place goes by in the app. Reserved: server ids are UUIDs or `sample-…`. */
export const GUEST_ID = "guest";

export function isGuestId(id: string | null | undefined): boolean {
  return id === GUEST_ID;
}

/** The guest place in the shape of a saved location, so pages can use either without asking which. */
export function guestLocation(p: GuestPlace): ObservingLocation {
  return { ...p, id: GUEST_ID, is_sample: false, created_at: "" };
}

/** The id to send to the server for `loc`: null for the guest place (it has no server row) or no place. */
export function serverLocationId(loc: Pick<ObservingLocation, "id"> | null | undefined): string | null {
  return loc && !isGuestId(loc.id) ? loc.id : null;
}

const finite = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

/** A stored guest place if it is well formed (preferences come from localStorage, which anyone can edit). */
export function parseGuestPlace(v: unknown): GuestPlace | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.label !== "string" || !o.label.trim() || typeof o.timezone !== "string" || !o.timezone) return null;
  if (!finite(o.latitude_deg, -90, 90) || !finite(o.longitude_deg, -180, 180)) return null;
  const elevation = finite(o.elevation_m, -500, 9000) ? o.elevation_m : null;
  return {
    label: o.label.slice(0, 120),
    latitude_deg: o.latitude_deg,
    longitude_deg: o.longitude_deg,
    elevation_m: elevation,
    timezone: o.timezone,
  };
}
