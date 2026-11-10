import type { ObservingLocation } from "../api/types";

const EARTH_RADIUS_KM = 6371.0088; // IUGG mean radius
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km (haversine). Plenty for "is this the same town?". */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** A saved location this close to a search result is treated as the same place and reused. */
export const SAME_PLACE_KM = 1;

/** The nearest saved location within SAME_PLACE_KM of the point, or null. */
export function findMatchingLocation(
  saved: ObservingLocation[],
  point: { latitude: number; longitude: number },
): ObservingLocation | null {
  let best: ObservingLocation | null = null;
  let bestKm = Infinity;
  for (const l of saved) {
    const km = distanceKm(l.latitude_deg, l.longitude_deg, point.latitude, point.longitude);
    if (km <= SAME_PLACE_KM && km < bestKm) {
      best = l;
      bestKm = km;
    }
  }
  return best;
}
