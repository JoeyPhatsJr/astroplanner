import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Recommendation } from "../api/types";
import { DEFAULT_PREFS, PrefsProvider } from "../state/prefs";
import { ExplorePage } from "./ExplorePage";

const mock = vi.hoisted(() => ({ results: [] as unknown[] }));

vi.mock("../api/hooks", () => ({
  useCurrentLocation: () => ({
    location: { id: "l1", label: "Backyard", latitude_deg: 40, longitude_deg: -75, timezone: "America/New_York", is_sample: false },
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
  useRecommendations: () => ({
    data: { observable_count: 2, results: mock.results, weather_status: "ok", weather_message: null },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: () => {},
  }),
}));
vi.mock("../components/astrolog/HistoryBadge", () => ({ HistoryBadge: () => null }));
vi.mock("../components/targets/TargetDetail", () => ({ TargetDetail: () => null }));

function rec(id: string, name: string, observable: boolean): Recommendation {
  return {
    target: { id, name, primary_designation: id, kind: "Galaxy", constellation: "Cygnus", angular_major_arcmin: 10, angular_minor_arcmin: 5 },
    visibility: {
      status: observable ? "observable" : "below_threshold",
      status_text: observable ? "Observable" : "Stays too low",
      status_detail: observable ? "" : "Peaks at 12° tonight.",
      can_observe: observable,
      best_window: observable ? { start_utc: "2026-11-10T02:00:00Z", end_utc: "2026-11-10T05:00:00Z", minutes: 180 } : null,
      max_alt_dark_deg: 55,
    },
    score: { total: observable ? 70 : null, max_total: 100 },
    sparkline_alt_deg: [10, 20, 30],
  } as unknown as Recommendation;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/explore"]}>
      <PrefsProvider initial={DEFAULT_PREFS}>
        <ExplorePage />
      </PrefsProvider>
    </MemoryRouter>,
  );
}

describe("Explore grouped list", () => {
  beforeEach(() => {
    mock.results = [rec("M31", "Andromeda", true), rec("M42", "Orion Nebula", true), rec("M81", "Bode", false), rec("M82", "Cigar", false)];
  });

  it("renders two lists; the second has the status sentence and no badge", () => {
    const { container } = renderPage();
    const observable = screen.getByRole("list", { name: "Targets" });
    const hidden = screen.getByRole("list", { name: "Not observable tonight" });
    expect(screen.getByRole("heading", { name: "Not observable tonight" })).toBeInTheDocument();
    expect(within(observable).getAllByRole("listitem")).toHaveLength(2);
    expect(within(hidden).getAllByRole("listitem")).toHaveLength(2);
    expect(within(hidden).getAllByText(/Stays too low\. Peaks at 12° tonight\./)).toHaveLength(2);
    expect(container.querySelector(".badge")).toBeNull();
  });

  it("each list is one panel and rows are not panels", () => {
    renderPage();
    for (const name of ["Targets", "Not observable tonight"]) {
      const list = screen.getByRole("list", { name });
      expect(list).toHaveClass("panel", "divide-y", "overflow-hidden");
      expect(list.querySelector(".panel")).toBeNull();
    }
  });

  it("omits the heading and list when every result is observable", () => {
    mock.results = [rec("M31", "Andromeda", true)];
    renderPage();
    expect(screen.queryByRole("heading", { name: "Not observable tonight" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Not observable tonight" })).not.toBeInTheDocument();
  });
});
