import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Advice, RunOut, StepView } from "../../api/processing";
import { ProcessingCoachPage } from "../../pages/ProcessingCoachPage";
import { AdviceList } from "./AdviceList";

const TITLES = ["Night report", "Convert & debayer", "Align", "Choose frames", "Stack", "Background", "Colour", "Stretch", "Stars & finish", "Compare"];
const IDS = ["report", "convert", "align", "select", "stack", "background", "colour", "stretch", "finish", "compare"] as const;

const mkRun = (over: Partial<Record<string, Partial<StepView>>> = {}): RunOut => ({
  id: "r1",
  capture_set_id: "cs1",
  target: { id: "t1", name: "Bubble Nebula" },
  night: { session_id: "s1", night_date: "2026-09-11", timezone: "America/Denver" },
  frames: 100,
  exptime_s: 10,
  steps: IDS.map((id, i) => ({
    id,
    n: i + 1,
    title: TITLES[i],
    does: `What ${id} does`,
    advice: [],
    gui: `Click ${id}`,
    command: null,
    expect: null,
    state: "todo" as const,
    blocked: null,
    ...(over[id] ?? {}),
  })),
  report: null,
  selection: [],
  comparison: {},
  siril_target: "1.4.5",
});

let run: RunOut;
let patches: unknown[];

beforeEach(() => {
  run = mkRun();
  patches = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PATCH") {
        const body = JSON.parse(String(init?.body));
        patches.push(body);
        for (const [id, st] of Object.entries(body.step_states ?? {})) {
          run = { ...run, steps: run.steps.map((s) => (s.id === id ? { ...s, state: st as "done" | "todo" } : s)) };
        }
      }
      void url;
      return new Response(JSON.stringify(run), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/astrolog/process/cs1"]}>
        <Routes>
          <Route path="/astrolog/process/:captureSetId" element={<ProcessingCoachPage />} />
          <Route path="/astrolog/targets/:id" element={<p>Target page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CoachRail", () => {
  it("lists the 10 titles in order and marks the current step", async () => {
    renderPage();
    const nav = await screen.findByRole("navigation", { name: "Processing steps" });
    const items = within(nav).getAllByRole("listitem");
    expect(items).toHaveLength(10);
    TITLES.forEach((t, i) => expect(items[i]).toHaveTextContent(t));
    expect(within(nav).getByRole("button", { current: "step" })).toHaveTextContent("Night report");
  });

  it("shows a check on done steps and starts at the first unfinished one", async () => {
    run = mkRun({ report: { state: "done" }, convert: { state: "done" } });
    renderPage();
    const nav = await screen.findByRole("navigation", { name: "Processing steps" });
    expect(within(nav).getAllByText("✓")).toHaveLength(2);
    expect(within(nav).getByRole("button", { current: "step" })).toHaveTextContent("Align");
  });
});

describe("AdviceList", () => {
  const adv = (over: Partial<Advice>): Advice => ({ rule_id: "x", setting: "Setting", why: "Because", basis: "measured", heuristic: false, source_url: null, ...over });
  it("labels every basis, tags heuristics and links Siril docs", () => {
    render(
      <AdviceList
        advice={[
          adv({ rule_id: "a", basis: "measured" }),
          adv({ rule_id: "b", basis: "siril-docs", source_url: "https://siril.example/doc" }),
          adv({ rule_id: "c", basis: "tutorial-default", heuristic: true }),
          adv({ rule_id: "d", basis: "taste" }),
        ]}
      />,
    );
    for (const l of ["Measured", "Siril docs", "Tutorial default", "Your taste"]) expect(screen.getByText(l)).toBeInTheDocument();
    expect(screen.getAllByText("Heuristic")).toHaveLength(1);
    const link = screen.getByRole("link", { name: /siril documentation/i });
    expect(link).toHaveAttribute("href", "https://siril.example/doc");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });
});

describe("ProcessingCoachPage", () => {
  it("Done, next step PATCHes and advances; Back returns", async () => {
    renderPage();
    await screen.findByText("Step 1 of 10");
    fireEvent.click(screen.getByRole("button", { name: "Done, next step" }));
    await screen.findByText("Step 2 of 10");
    expect(patches[0]).toEqual({ step_states: { report: "done" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByText("Step 1 of 10");
  });

  it("last step offers Save to AstroLog instead of Done and returns to the target", async () => {
    run = mkRun(Object.fromEntries(IDS.slice(0, 9).map((id) => [id, { state: "done" as const }])));
    renderPage();
    await screen.findByText("Step 10 of 10");
    expect(screen.queryByRole("button", { name: "Done, next step" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save to AstroLog" }));
    await waitFor(() => expect(patches[0]).toEqual({ step_states: { compare: "done" } }));
    await screen.findByText("Target page");
  });

  it("shows the blocked text instead of advice", async () => {
    run = mkRun({
      report: {
        blocked: "Run the first script first.",
        advice: [{ rule_id: "a", setting: "Hidden setting", why: "w", basis: "measured", heuristic: false, source_url: null }],
      },
    });
    renderPage();
    await screen.findByText("Run the first script first.");
    expect(screen.queryByText("Hidden setting")).toBeNull();
  });

  it("shows an error state when the run cannot start", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "The coach supports Seestar S30 FITS nights only." }), { status: 422 })));
    renderPage();
    expect(await screen.findByText("The coach supports Seestar S30 FITS nights only.")).toBeInTheDocument();
  });
});
