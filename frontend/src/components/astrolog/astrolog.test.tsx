import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { LibraryRow, TargetPage } from "../../api/astrolog";
import type { ObservingSession } from "../../api/types";
import { ConfirmProvider } from "../ui/ConfirmDialog";
import { TargetTile } from "./TargetTile";

const mocks = vi.hoisted(() => ({ target: null as unknown, sessions: null as unknown }));

vi.mock("../../api/astrolog", async (orig) => {
  const mod = await orig<typeof import("../../api/astrolog")>();
  const idle = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null };
  return {
    ...mod,
    useAstroLogTarget: () => ({ data: mocks.target, isLoading: false, error: null, refetch: vi.fn() }),
    useUploadFinalImage: () => idle,
    useLinkStack: () => idle,
    useUpdateLibraryTarget: () => idle,
  };
});
vi.mock("../../api/hooks", async (orig) => {
  const mod = await orig<typeof import("../../api/hooks")>();
  const idle = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null };
  return {
    ...mod,
    useSessions: () => ({ data: mocks.sessions, isLoading: false, error: null, refetch: vi.fn() }),
    useLocations: () => ({ data: [] }),
    useSessionMutations: () => ({ update: idle, reorder: idle, removeTarget: idle, remove: idle }),
  };
});

vi.mock("../../state/prefs", () => ({
  usePrefs: () => ({ prefs: { nightDate: "2026-09-11", activeSessionId: null, locationId: null }, update: vi.fn() }),
}));

import { AstroLogPage } from "../../pages/AstroLogPage";
import { TargetLogPage } from "../../pages/TargetLogPage";

const row = (over: Partial<LibraryRow>): LibraryRow => ({
  id: "t1",
  display_name: "Bubble Nebula",
  kind: "catalog",
  catalog_target_id: "ngc7635",
  custom_name: null,
  category: "nebula",
  thumb_url: null,
  headline: { seconds: 6540, label: "stack", provenance: "Siril" },
  captured_s: 10150,
  nights: 1,
  ...over,
});

const page = (over: Partial<TargetPage>): TargetPage => ({
  target: { id: "t1", display_name: "Bubble Nebula", kind: "catalog", catalog_target_id: "ngc7635", custom_name: null, category: "nebula" },
  final_image: null,
  stack: null,
  stacks: [],
  headline: { seconds: 6540, label: "stack", provenance: "Siril" },
  captured_s: 10150,
  frames_total: 1015,
  percent_used: 64,
  facts: [{ label: "Filter", value: "LP", source_key: "FILTER" }],
  nights: [],
  stack_suggestion_id: null,
  ...over,
});

function renderTarget() {
  return render(
    <MemoryRouter initialEntries={["/astrolog/targets/t1"]}>
      <Routes>
        <Route path="/astrolog/targets/:targetId" element={<TargetLogPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TargetTile", () => {
  it("shows a stack headline as '1 h 49 m' in the final stack", () => {
    render(<MemoryRouter><TargetTile row={row({})} /></MemoryRouter>);
    expect(screen.getByText("1 h 49 m")).toBeInTheDocument();
    expect(screen.getByText("in the final stack")).toBeInTheDocument();
    expect(screen.getByText("No final picture yet")).toBeInTheDocument();
  });

  it("shows a captured headline labelled 'captured'", () => {
    render(<MemoryRouter><TargetTile row={row({ headline: { seconds: 10150, label: "captured", provenance: "x" } })} /></MemoryRouter>);
    expect(screen.getByText("2 h 49 m")).toBeInTheDocument();
    expect(screen.getByText("captured")).toBeInTheDocument();
    expect(screen.queryByText("in the final stack")).toBeNull();
  });
});

describe("TargetLogPage", () => {
  it("shows the usage bar when percent_used is known", () => {
    mocks.target = page({ stack: { id: "s1", source_filename: "x.fit", stack_count: 654, livetime_s: 6540, exptime_s: 10, expstart_jd: null, expend_jd: null, program: "Siril", provenance: "header", integration_s: 6540, integration_provenance: "header" } });
    renderTarget();
    expect(screen.getByText(/1,015 frames/)).toHaveTextContent("654 of 1,015 frames used (64%) · 2 h 49 m captured");
    expect(screen.getByText("FILTER")).toBeInTheDocument();
  });

  it("hides the bar when percent_used is null", () => {
    mocks.target = page({ percent_used: null, headline: { seconds: 10150, label: "captured", provenance: "x" } });
    renderTarget();
    expect(screen.queryByText(/frames used/)).toBeNull();
    expect(screen.getByText("2 h 49 m")).toBeInTheDocument();
  });
});

describe("night detail", () => {
  it("lists not_shot targets under 'Planned, not shot' and shot sets as links", () => {
    mocks.sessions = [
      {
        id: "s1", title: "Night", location_id: null, equipment_id: null, local_night_date: "2026-09-11", start_utc: null, end_utc: null,
        status: "completed", notes: null, created_at: "", updated_at: "", target_count: 1,
        targets: [{ id: "st1", target_id: "m27", sort_order: 0, planned_start_utc: null, planned_end_utc: null, notes: null,
          target: { id: "m27", primary_designation: "M 27", name: "Dumbbell Nebula", category: "nebula", kind: "planetary_nebula", constellation: "Vul", ra_deg: 0, dec_deg: 0 } }],
        capture_sets: [{ library_target_id: "t1", display_name: "Bubble Nebula", device: "Seestar S30", frames: 1015, captured_s: 10150 }],
        not_shot: ["m27"],
      } satisfies Partial<ObservingSession> & Record<string, unknown>,
    ];
    render(
      <MemoryRouter initialEntries={["/astrolog/nights/s1"]}>
        <ConfirmProvider>
          <Routes>
            <Route path="/astrolog/nights/:sessionId" element={<AstroLogPage />} />
          </Routes>
        </ConfirmProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Planned, not shot" })).toBeInTheDocument();
    expect(screen.getAllByText(/Dumbbell Nebula/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Bubble Nebula/ })).toHaveAttribute("href", "/astrolog/targets/t1");
    expect(screen.queryByText(/Coming in Phase 2/)).toBeNull();
  });
});
