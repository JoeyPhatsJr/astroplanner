import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { GUEST_ID, guestLocation, parseGuestPlace, serverLocationId } from "../lib/guestPlace";
import { DEFAULT_PREFS, PrefsProvider, type Prefs } from "../state/prefs";
import { qk, useCurrentLocation, useObserver } from "./hooks";
import type { ObservingLocation } from "./types";

const sample: ObservingLocation = {
  id: "sample-location", label: "Philadelphia, PA (sample)", latitude_deg: 39.9526, longitude_deg: -75.1652,
  elevation_m: 12, timezone: "America/New_York", is_sample: true, created_at: "2026-01-01T00:00:00Z",
};
const own: ObservingLocation = { ...sample, id: "home", label: "Home", is_sample: false, latitude_deg: 40.1 };
const guestPlace = { label: "Tucson, Arizona, US", latitude_deg: 32.22, longitude_deg: -110.97, elevation_m: 728, timezone: "America/Phoenix" };

function setup(prefs: Partial<Prefs>, locations: ObservingLocation[] | undefined) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (locations) qc.setQueryData(qk.locations, locations);
  else qc.setQueryDefaults(qk.locations, { queryFn: () => new Promise<never>(() => {}) }); // stays loading
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, ...prefs }}>{children}</PrefsProvider>
    </QueryClientProvider>
  );
  return renderHook(() => ({ current: useCurrentLocation(), observer: useObserver() }), { wrapper });
}

describe("useCurrentLocation and the browser-only guest place", () => {
  it("returns the guest place when it is chosen, shaped like a saved location", () => {
    const { result } = setup({ guestPlace, locationId: GUEST_ID }, [sample]);
    expect(result.current.current.location).toEqual({ ...guestPlace, id: "guest", is_sample: false, created_at: "" });
    expect(result.current.observer).toMatchObject({ lat: 32.22, lon: -110.97, elevation_m: 728, timezone: "America/Phoenix" });
  });

  it("has the chosen guest place at once, while the list is still loading", () => {
    const { result } = setup({ guestPlace, locationId: GUEST_ID }, undefined);
    expect(result.current.current.location?.id).toBe("guest");
    expect(result.current.current.isLoading).toBe(false);
  });

  it("signed out with nothing else chosen: the guest place before the sample", () => {
    const { result } = setup({ guestPlace, locationId: null }, [sample]);
    expect(result.current.current.location?.id).toBe("guest");
  });

  it("a chosen place that is no longer listed (someone's own, after signing out) falls back to the guest place", () => {
    const { result } = setup({ guestPlace, locationId: "home" }, [sample]);
    expect(result.current.current.location?.id).toBe("guest");
  });

  it("a chosen saved place wins over the guest place", () => {
    const { result } = setup({ guestPlace, locationId: "home" }, [sample, own]);
    expect(result.current.current.location?.id).toBe("home");
  });

  it("without a guest place, falls back to the first listed place (the sample)", () => {
    const { result } = setup({ guestPlace: null, locationId: GUEST_ID }, [sample]);
    expect(result.current.current.location?.id).toBe("sample-location");
  });
});

describe("guest place helpers", () => {
  it("never sends the guest id to the server", () => {
    expect(serverLocationId(guestLocation(guestPlace))).toBeNull();
    expect(serverLocationId(own)).toBe("home");
    expect(serverLocationId(null)).toBeNull();
  });

  it("drops a malformed stored guest place, and an out-of-range elevation", () => {
    expect(parseGuestPlace(guestPlace)).toEqual(guestPlace);
    expect(parseGuestPlace({ ...guestPlace, latitude_deg: 91 })).toBeNull();
    expect(parseGuestPlace({ ...guestPlace, timezone: "" })).toBeNull();
    expect(parseGuestPlace("Tucson")).toBeNull();
    expect(parseGuestPlace({ ...guestPlace, elevation_m: -9999 })).toEqual({ ...guestPlace, elevation_m: null });
  });
});
