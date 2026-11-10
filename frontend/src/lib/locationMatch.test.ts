import { describe, expect, it } from "vitest";
import type { ObservingLocation } from "../api/types";
import { distanceKm, findMatchingLocation } from "./locationMatch";

const loc = (id: string, latitude_deg: number, longitude_deg: number): ObservingLocation => ({
  id,
  label: id,
  latitude_deg,
  longitude_deg,
  elevation_m: null,
  timezone: "America/New_York",
  is_sample: false,
  created_at: "2026-11-01T00:00:00Z",
});

describe("distanceKm", () => {
  it("is zero for the same point", () => {
    expect(distanceKm(39.9526, -75.1652, 39.9526, -75.1652)).toBe(0);
  });
  it("matches a known distance (Philadelphia to New York City, about 130 km)", () => {
    expect(distanceKm(39.9526, -75.1652, 40.7128, -74.006)).toBeCloseTo(129.6, 0);
  });
  it("handles the antimeridian", () => {
    expect(distanceKm(0, 179.99, 0, -179.99)).toBeLessThan(3);
  });
});

describe("findMatchingLocation", () => {
  const philly = loc("philly", 39.9526, -75.1652);
  const nyc = loc("nyc", 40.7128, -74.006);

  it("returns null when nothing is saved", () => {
    expect(findMatchingLocation([], { latitude: 39.95, longitude: -75.16 })).toBeNull();
  });
  it("reuses a saved location at the same place", () => {
    expect(findMatchingLocation([nyc, philly], { latitude: 39.9526, longitude: -75.1652 })).toBe(philly);
  });
  it("reuses one within about 1 km", () => {
    // ~0.5 km north of the saved point
    expect(findMatchingLocation([philly], { latitude: 39.957, longitude: -75.1652 })).toBe(philly);
  });
  it("does not reuse one a few km away", () => {
    expect(findMatchingLocation([philly], { latitude: 39.99, longitude: -75.1652 })).toBeNull();
  });
  it("picks the nearest when several are close", () => {
    const near = loc("near", 39.953, -75.1652);
    const nearer = loc("nearer", 39.9527, -75.1652);
    expect(findMatchingLocation([near, nearer], { latitude: 39.9526, longitude: -75.1652 })).toBe(nearer);
  });
});
