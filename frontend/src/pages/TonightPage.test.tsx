import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EquipmentProfile } from "../api/types";
import { DEFAULT_PREFS, PrefsProvider } from "../state/prefs";
import { TonightPage } from "./TonightPage";

const mock = vi.hoisted(() => ({ eq: null as unknown }));
const idle = { data: undefined, isLoading: false, isFetching: false, error: null, refetch: () => {} };

vi.mock("../api/hooks", () => ({
  useCurrentLocation: () => ({
    location: { id: "l1", label: "Backyard", latitude_deg: 40, longitude_deg: -75, timezone: "America/New_York", is_sample: false },
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
  useCurrentEquipment: () => mock.eq,
  useNightDate: () => ({ nightDate: "2026-11-09", isAuto: true }),
  useTonight: () => idle,
  useVisibility: () => idle,
  useRecommendations: () => ({ ...idle, data: { observable_count: 0, results: [] } }),
}));
vi.mock("../state/activeSession", () => ({
  useActiveSession: () => ({ auth: "signedIn", signedIn: true, addTarget: () => {}, inSession: () => false, isAdding: false, error: null }),
}));
vi.mock("../components/session/SessionPlanPanel", () => ({ SessionPlanPanel: () => null }));
// The target sheet's account-check retry reads the account query; here the account is mocked as signed in.
vi.mock("../components/account/AccountCheckError", () => ({
  useAccountCheckRetry: () => ({ failed: false, retrying: false, retry: async () => {}, buttonRef: { current: null }, error: null }),
  AccountCheckNote: () => null,
}));

const s30 = (over: Partial<EquipmentProfile> = {}) =>
  ({ id: "e1", name: "Seestar S30 (original)", fov_deg: 2.46, fov_definition: "unknown", ...over }) as EquipmentProfile;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/tonight"]}>
      <PrefsProvider initial={DEFAULT_PREFS}>
        <TonightPage />
      </PrefsProvider>
    </MemoryRouter>,
  );
}

describe("Tonight targets intro: FOV-axis caveat stated once", () => {
  beforeEach(() => {
    mock.eq = null;
  });

  it("states the unverified axis when the equipment FOV definition is unknown", () => {
    mock.eq = s30();
    renderPage();
    expect(screen.getByText(/Field sizes assume about 148′ across; the Seestar S30 \(original\) FOV axis is unverified\./)).toBeInTheDocument();
  });

  it("omits the sentence when the axis is known", () => {
    mock.eq = s30({ fov_definition: "horizontal" });
    renderPage();
    expect(screen.queryByText(/FOV axis is unverified/)).not.toBeInTheDocument();
  });
});
