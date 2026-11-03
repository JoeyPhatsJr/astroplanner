import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { LibraryRow, TargetPage } from "../../api/astrolog";
import type { ObservingSession } from "../../api/types";
import { ConfirmProvider } from "../ui/ConfirmDialog";
import { FinalPicturePicker } from "./FinalPicturePicker";
import { TargetTile } from "./TargetTile";

const mocks = vi.hoisted(() => ({
  target: null as unknown,
  sessions: null as unknown,
  removeSession: null as null | ((id: string) => Promise<unknown>),
}));

vi.mock("../../api/astrolog", async (orig) => {
  const mod = await orig<typeof import("../../api/astrolog")>();
  const idle = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null };
  return {
    ...mod,
    useAstroLogTarget: () => ({ data: mocks.target, isLoading: false, error: null, refetch: vi.fn() }),
    useUploadFinalImage: () => idle,
    useLinkStack: () => idle,
    useUpdateLibraryTarget: () => idle,
    useLinkVariable: () => idle,
  };
});
vi.mock("../../api/variables", () => ({ useVariables: () => ({ data: undefined }) }));
vi.mock("../../api/hooks", async (orig) => {
  const mod = await orig<typeof import("../../api/hooks")>();
  const idle = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null };
  return {
    ...mod,
    useSessions: () => ({ data: mocks.sessions, isLoading: false, error: null, refetch: vi.fn() }),
    useLocations: () => ({ data: [] }),
    useSessionMutations: () => ({
      update: idle,
      reorder: idle,
      removeTarget: idle,
      remove: { ...idle, mutateAsync: mocks.removeSession ?? idle.mutateAsync },
    }),
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
  headline: { seconds: 6540, label: "stack", provenance: "Siril", basis: "linked" },
  captured_s: 10150,
  nights: 1,
  ...over,
});

const page = (over: Partial<TargetPage>): TargetPage => ({
  target: { id: "t1", display_name: "Bubble Nebula", kind: "catalog", catalog_target_id: "ngc7635", custom_name: null, category: "nebula" },
  final_image: null,
  stack: null,
  stacks: [],
  headline: { seconds: 6540, label: "stack", provenance: "Siril", basis: "linked" },
  captured_s: 10150,
  frames_total: 1015,
  percent_used: 64,
  frames_in_stack_range: 1015,
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

  it("says 'in the latest stack' and 'nights unknown' for a stack-only target", () => {
    render(<MemoryRouter><TargetTile row={row({ headline: { seconds: 6540, label: "stack", provenance: "header", basis: "latest" }, captured_s: null, nights: null })} /></MemoryRouter>);
    expect(screen.getByText("in the latest stack")).toBeInTheDocument();
    expect(screen.queryByText("in the final stack")).toBeNull();
    expect(screen.getByText("nights unknown")).toBeInTheDocument();
    expect(screen.queryByText(/0 nights/)).toBeNull();
  });
});

const stackOut = (id: string, source_filename: string, stack_count: number | null) => ({
  id, source_filename, stack_count, livetime_s: null, exptime_s: null, expstart_jd: null, expend_jd: null,
  program: null, provenance: "header", integration_s: 6540, integration_provenance: "header",
});

describe("FinalPicturePicker", () => {
  it("suggests the stack from the chosen file's name and re-syncs when the choice changes", () => {
    const stacks = [stackOut("new", "Stacked_300.fit", 300), stackOut("b", "NGC_7635_654x10sec.fit", null)];
    render(<FinalPicturePicker targetId="t1" stacks={stacks} suggestionId={null} />);
    const select = screen.getByLabelText("Stacked from") as HTMLSelectElement;
    expect(select.value).toBe("");
    const input = screen.getByLabelText("Final picture");
    fireEvent.change(input, { target: { files: [new File(["x"], "NGC7635_654x10sec_starnet.tif")] } });
    expect(select.value).toBe("b");
    fireEvent.change(input, { target: { files: [new File(["x"], "NGC7635_999x10sec.tif")] } });
    expect(select.value).toBe("");
    fireEvent.change(input, { target: { files: [new File(["x"], "final.tif")] } });
    expect(select.value).toBe("new");
  });
});

describe("TargetLogPage", () => {
  it("shows the usage bar when percent_used is known", () => {
    mocks.target = page({ stack: { id: "s1", source_filename: "x.fit", stack_count: 654, livetime_s: 6540, exptime_s: 10, expstart_jd: null, expend_jd: null, program: "Siril", provenance: "header", integration_s: 6540, integration_provenance: "header" } });
    renderTarget();
    expect(screen.getByText(/frames used/)).toHaveTextContent("654 of 1,015 frames used (64%) · 2 h 49 m captured");
    expect(screen.getByText("FILTER")).toBeInTheDocument();
  });

  it("uses frames_in_stack_range (not frames_total) as the denominator", () => {
    mocks.target = page({
      frames_total: 1515,
      frames_in_stack_range: 1015,
      captured_s: 15150,
      stack: { id: "s1", source_filename: "x.fit", stack_count: 654, livetime_s: 6540, exptime_s: 10, expstart_jd: 1, expend_jd: 2, program: "Siril", provenance: "header", integration_s: 6540, integration_provenance: "header" },
    });
    renderTarget();
    expect(screen.getByText(/frames used/)).toHaveTextContent("654 of 1,015 frames used (64%) · 4 h 12 m captured");
    expect(screen.queryByText(/of 1,515/)).toBeNull();
  });

  it("hides the bar when frames_in_stack_range is null", () => {
    mocks.target = page({ percent_used: null, frames_in_stack_range: null });
    renderTarget();
    expect(screen.queryByText(/frames used/)).toBeNull();
  });

  it("shows each night's local start → end and per-frame exposure", () => {
    mocks.target = page({
      nights: [{ session_id: "s1", night_date: "2026-09-11", device: "Seestar S30", frames: 1015, captured_s: 10150,
        first_utc: "2026-09-12T03:11:24.634Z", last_utc: "2026-09-12T09:43:55.2Z", exptimes_s: [10], timezone: "America/New_York", planned: false }],
    });
    renderTarget();
    expect(screen.getByText(/23:11:24 → 05:43:55 EDT/)).toBeInTheDocument();
    expect(screen.getByText(/1,015 × 10 s/)).toBeInTheDocument();
  });

  it("labels a stack-only target 'in the latest stack' with nights unknown", () => {
    mocks.target = page({ headline: { seconds: 6540, label: "stack", provenance: "header", basis: "latest" }, captured_s: null, frames_total: 0, percent_used: null, frames_in_stack_range: null,
      stacks: [{ id: "s1", source_filename: "x.fit", stack_count: 654, livetime_s: 6540, exptime_s: 10, expstart_jd: null, expend_jd: null, program: "Siril", provenance: "header", integration_s: 6540, integration_provenance: "header" }] });
    renderTarget();
    expect(screen.getByText("in the latest stack")).toBeInTheDocument();
    expect(screen.getByText(/Nights unknown/)).toBeInTheDocument();
  });

  it("hides Rename on Unsorted and explains why", () => {
    mocks.target = page({ target: { id: "u", display_name: "Unsorted", kind: "unsorted", catalog_target_id: null, custom_name: null, category: null } });
    renderTarget();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.getByText("Re-import is not needed: name sets during import.")).toBeInTheDocument();
  });

  it("lets a custom target be renamed up to 160 characters or moved to Unsorted", () => {
    mocks.target = page({ target: { id: "c", display_name: "Blob", kind: "custom", catalog_target_id: null, custom_name: "Blob", category: null } });
    renderTarget();
    expect(screen.getByLabelText("Name")).toHaveAttribute("maxLength", "160");
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move to Unsorted" })).toBeInTheDocument();
  });

  it("hides the bar when percent_used is null", () => {
    mocks.target = page({ percent_used: null, headline: { seconds: 10150, label: "captured", provenance: "x" } });
    renderTarget();
    expect(screen.queryByText(/frames used/)).toBeNull();
    expect(screen.getByText("2 h 49 m")).toBeInTheDocument();
  });
});

const nightSession = (over: Record<string, unknown> = {}) => ({
  id: "s1", title: "Night", location_id: null, equipment_id: null, local_night_date: "2026-09-11", start_utc: null, end_utc: null,
  status: "completed", notes: null, created_at: "", updated_at: "", target_count: 1,
  targets: [{ id: "st1", target_id: "m27", sort_order: 0, planned_start_utc: null, planned_end_utc: null, notes: null,
    target: { id: "m27", primary_designation: "M 27", name: "Dumbbell Nebula", category: "nebula", kind: "planetary_nebula", constellation: "Vul", ra_deg: 0, dec_deg: 0 } }],
  capture_sets: [{ library_target_id: "t1", display_name: "Bubble Nebula", device: "Seestar S30", frames: 1015, captured_s: 10150,
    first_utc: "2026-09-12T03:11:24Z", last_utc: "2026-09-12T09:43:55Z", exptimes_s: [10] }],
  not_shot: ["m27"],
  ...over,
}) satisfies Partial<ObservingSession> & Record<string, unknown>;

function renderNight() {
  return render(
    <MemoryRouter initialEntries={["/astrolog/nights/s1"]}>
      <ConfirmProvider>
        <Routes>
          <Route path="/astrolog/nights/:sessionId" element={<AstroLogPage />} />
          <Route path="/astrolog/nights" element={<p>nights list</p>} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>,
  );
}

describe("night detail", () => {
  it("lists not_shot targets under 'Planned, not shot' and shot sets as links", () => {
    mocks.sessions = [nightSession()];
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
    expect(screen.queryByText("m27")).toBeNull();
  });

  it("shows each capture set's start → end (UTC without a location) and exposure", () => {
    mocks.sessions = [nightSession()];
    renderNight();
    expect(screen.getByText(/03:11:24 → 09:43:55 UTC/)).toBeInTheDocument();
    expect(screen.getByText(/1,015 × 10 s/)).toBeInTheDocument();
  });

  it("disables Delete when the night has imported captures", () => {
    mocks.sessions = [nightSession()];
    renderNight();
    expect(screen.getByRole("button", { name: /Delete/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: "Completed" })).toHaveValue("completed");
  });

  it("shows a failed delete as a message instead of an unhandled rejection", async () => {
    mocks.sessions = [nightSession({ capture_sets: [], not_shot: [] })];
    mocks.removeSession = () => Promise.reject(new Error("This night has imported captures, so it can't be deleted."));
    renderNight();
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete session" }));
    await waitFor(() => expect(screen.queryByText("nights list")).toBeNull());
    mocks.removeSession = null;
  });
});
