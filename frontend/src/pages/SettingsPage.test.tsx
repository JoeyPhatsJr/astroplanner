import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { qk } from "../api/hooks";
import { createQueryClient } from "../api/queryClient";
import type { EquipmentProfile, ObservingLocation } from "../api/types";
import { ConfirmProvider } from "../components/ui/ConfirmDialog";
import { DEFAULT_PREFS, PrefsProvider } from "../state/prefs";
import { seedSignedIn, seedSignedOut } from "../test/auth";
import { SettingsPage } from "./SettingsPage";

const place: ObservingLocation = {
  id: "loc-1", label: "Backyard", latitude_deg: 40, longitude_deg: -75, elevation_m: 60,
  timezone: "America/New_York", is_sample: false, created_at: "2026-11-01T00:00:00Z",
};
const base = {
  manufacturer: null, aperture_mm: 80, focal_length_mm: 480, focal_ratio: 6, fov_deg: 2, fov_definition: "unknown",
  wide_fov_deg: null, sensor: null, mount_type: null, source_url: null, notes: null, created_at: "2026-11-01T00:00:00Z",
} as const;
const preset: EquipmentProfile = { ...base, id: "seestar-s30", name: "Seestar S30", is_preset: true, is_verified: true };
const custom: EquipmentProfile = { ...base, id: "eq-1", name: "My refractor", is_preset: false, is_verified: false };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Not found." }), { status: 404 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSettings(signedIn: boolean) {
  const qc = createQueryClient();
  if (signedIn) seedSignedIn(qc);
  else seedSignedOut(qc);
  qc.setQueryData(qk.locations, [place]);
  qc.setQueryData(qk.equipment, [preset, custom]);
  render(
    <QueryClientProvider client={qc}>
      <PrefsProvider initial={DEFAULT_PREFS}>
        <ConfirmProvider>
          <MemoryRouter initialEntries={["/settings"]}>
            <SettingsPage />
          </MemoryRouter>
        </ConfirmProvider>
      </PrefsProvider>
    </QueryClientProvider>,
  );
}

describe("Settings: shared places and equipment", () => {
  it("signed out: no edit or delete controls, adding a place still works, and a way to sign in", () => {
    renderSettings(false);
    expect(screen.queryByRole("button", { name: "Edit Backyard" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Backyard" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Duplicate as custom/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Custom profile/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete$/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Add location/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login?next=%2Fsettings");
  });

  it("signed in: edit and delete controls are back and the sign-in note is gone", () => {
    renderSettings(true);
    expect(screen.getByRole("button", { name: "Edit Backyard" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete Backyard" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Duplicate as custom/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Custom profile/ })).toBeTruthy();
    // The profile buttons carry the profile's name, as the place buttons do.
    expect(screen.getByRole("button", { name: "Edit My refractor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete My refractor" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit Seestar S30" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });
});

const sample: ObservingLocation = { ...place, id: "sample-location", label: "Philadelphia, PA (sample)", is_sample: true };
const guestPlace = { label: "Tucson, Arizona, US", latitude_deg: 32.22, longitude_deg: -110.97, elevation_m: 728, timezone: "America/Phoenix" };

function renderWith(opts: { signedIn: boolean; locations: ObservingLocation[]; guest?: typeof guestPlace | null }) {
  const qc = createQueryClient();
  if (opts.signedIn) seedSignedIn(qc);
  else seedSignedOut(qc);
  qc.setQueryData(qk.locations, opts.locations);
  qc.setQueryData(qk.equipment, [preset]);
  const prefs = { ...DEFAULT_PREFS, guestPlace: opts.guest ?? null, locationId: opts.guest ? "guest" : null };
  render(
    <QueryClientProvider client={qc}>
      <PrefsProvider initial={prefs}>
        <ConfirmProvider>
          <MemoryRouter initialEntries={["/settings"]}>
            <SettingsPage />
          </MemoryRouter>
        </ConfirmProvider>
      </PrefsProvider>
    </QueryClientProvider>,
  );
  return qc;
}

const fetchCalls = () => (fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls;

describe("Settings: private places, shared samples", () => {
  it("never offers to edit or delete a sample, even signed in", () => {
    renderWith({ signedIn: true, locations: [sample, place] });
    expect(screen.queryByRole("button", { name: `Edit ${sample.label}` })).toBeNull();
    expect(screen.queryByRole("button", { name: `Delete ${sample.label}` })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit Backyard" })).toBeTruthy();
  });

  it("says the copy is current: private to the account, samples and presets shared and read-only", () => {
    renderWith({ signedIn: false, locations: [sample] });
    expect(screen.getByText(/Your places and equipment are private to your account/)).toBeTruthy();
    expect(screen.getByText(/Samples and presets are shared and read-only/)).toBeTruthy();
    expect(screen.getByText(/the place you add is kept in this browser only/)).toBeTruthy();
    expect(screen.queryByText(/shared by everyone/)).toBeNull();
  });

  it("shows the browser-only place with its note; signed out, there is nothing to save it to", () => {
    renderWith({ signedIn: false, locations: [sample], guest: guestPlace });
    expect(screen.getByText("Tucson, Arizona, US")).toBeTruthy();
    expect(screen.getByText("Saved in this browser only")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save to my account" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Tucson, Arizona, US from this browser" })).toBeTruthy();
  });

  it("signed in: 'Save to my account' saves the browser-only place and makes it the current one", async () => {
    const saved: ObservingLocation = { ...place, ...guestPlace, id: "new-place" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/locations" && init?.method === "POST") return new Response(JSON.stringify(saved), { status: 201 });
        if (url === "/api/locations") return new Response(JSON.stringify([sample]), { status: 200 });
        return new Response(JSON.stringify({ detail: "Not found." }), { status: 404 });
      }),
    );
    renderWith({ signedIn: true, locations: [sample], guest: guestPlace });
    fireEvent.click(screen.getByRole("button", { name: "Save to my account" }));
    await waitFor(() => expect(fetchCalls().some(([u, i]) => u === "/api/locations" && i?.method === "POST")).toBe(true));
    const [, init] = fetchCalls().find(([u, i]) => u === "/api/locations" && i?.method === "POST")!;
    expect(JSON.parse(String(init!.body))).toEqual(guestPlace);
    await waitFor(() => expect(screen.queryByText("Saved in this browser only")).toBeNull());
  });

  it("signed out: a new place is kept in this browser, and nothing is sent to the server", async () => {
    renderWith({ signedIn: false, locations: [sample] });
    fireEvent.click(screen.getByRole("button", { name: /Add location/ }));
    expect(screen.getByText(/this place is kept in this browser only/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Back field" } });
    fireEvent.change(screen.getByLabelText(/Latitude/), { target: { value: "41.5" } });
    fireEvent.change(screen.getByLabelText(/Longitude/), { target: { value: "-73.25" } });
    fireEvent.change(screen.getByLabelText("Timezone (IANA)"), { target: { value: "America/New_York" } });
    fireEvent.click(screen.getByRole("button", { name: "Keep in this browser" }));
    expect(await screen.findByText("Back field")).toBeTruthy();
    expect(screen.getByText("Saved in this browser only")).toBeTruthy();
    expect(screen.getByText(/41\.5/)).toBeTruthy(); // the coordinates line of the browser-only place
    expect(fetchCalls().some(([u, i]) => u.startsWith("/api/locations") && i?.method && i.method !== "GET")).toBe(false);
  });

  it("credits GeoNames when it fills a place from the search", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("/api/geocode")
          ? new Response(JSON.stringify({ results: [{ label: "Tucson, Arizona, US", latitude: 32.22, longitude: -110.97, elevation_m: 728, timezone: "America/Phoenix", country_code: "US", population: 1 }], source: "Open-Meteo Geocoding API" }), { status: 200 })
          : new Response(JSON.stringify({ detail: "Not found." }), { status: 404 }),
      ),
    );
    renderWith({ signedIn: true, locations: [sample] });
    fireEvent.click(screen.getByRole("button", { name: /Add location/ }));
    fireEvent.change(screen.getByLabelText("Find a city or place"), { target: { value: "Tucson" } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Tucson, Arizona, US/ }));
    expect(screen.getByText(/Filled from Open-Meteo geocoding/)).toBeTruthy();
    const link = screen.getByRole("link", { name: "GeoNames" });
    expect(link.getAttribute("href")).toBe("https://www.geonames.org/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(link.parentElement?.textContent).toMatch(/Location data based on GeoNames/);
  });
});
