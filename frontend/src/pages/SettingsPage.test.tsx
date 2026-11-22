import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
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
    expect(screen.getByRole("button", { name: /^Edit$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Delete$/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });
});
