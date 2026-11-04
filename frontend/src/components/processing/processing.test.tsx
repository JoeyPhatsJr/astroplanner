import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Advice, RunOut, StepView } from "../../api/processing";
import { ProcessingCoachPage } from "../../pages/ProcessingCoachPage";
import { PrefsProvider } from "../../state/prefs";
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
    <PrefsProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/astrolog/process/cs1"]}>
          <Routes>
            <Route path="/astrolog/process/:captureSetId" element={<ProcessingCoachPage />} />
            <Route path="/astrolog/targets/:id" element={<p>Target page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </PrefsProvider>,
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

  it("offers no Done on a blocked step and sends no PATCH when moving on", async () => {
    run = mkRun({ report: { blocked: "Run the first script first." } });
    renderPage();
    await screen.findByText("Run the first script first.");
    expect(screen.queryByRole("button", { name: "Done, next step" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Step 2 of 10");
    expect(patches).toHaveLength(0);
  });

  it("shows an error state when the run cannot start", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "The coach supports Seestar S30 FITS nights only." }), { status: 422 })));
    renderPage();
    expect(await screen.findByText("The coach supports Seestar S30 FITS nights only.")).toBeInTheDocument();
  });
});

const mkReport = (over: Record<string, unknown> = {}) => ({
  totals: { captured: 1015, aligned: 851, kept: 654, captured_s: 10150, aligned_s: 8510, kept_s: 6540, matched: 1015, unmatched: 0 },
  medians: { stars: 44, fwhm: 2.25, wfwhm: 2.1, roundness: 0.8 },
  ranges: { stars: [13, 64] },
  bins: [
    { start_utc: "2026-09-11T05:00:00Z", label_local: "1:00 AM", captured: 40, aligned: 30, kept: 20 },
    { start_utc: "2026-09-11T05:30:00Z", label_local: "1:30 AM", captured: 40, aligned: 38, kept: 36 },
  ],
  findings: [
    { id: "split", title: "Before 3:30 AM, about half the frames were lost", detail: "From 3:30 on, 91% made it.", basis: "measured", heuristic: true },
  ],
  time_unknown: 0,
  timezone: "America/Denver",
  units: { fwhm: "px", wfwhm: "px", background: "Siril units, relative" },
  ...over,
});

const textFile = (rel: string, text: string) => {
  const f = new File([text], rel.split("/").pop() as string);
  Object.defineProperty(f, "webkitRelativePath", { value: rel });
  Object.defineProperty(f, "text", { value: async () => text });
  return f;
};

describe("night report step", () => {
  it("shows totals, findings with basis and Heuristic tag, and a described chart", async () => {
    run = { ...mkRun(), report: mkReport(), folder: { run_dir: "process", kept_error: null } } as unknown as RunOut;
    renderPage();
    const stats = await screen.findByRole("group", { name: "Night totals" });
    expect(stats).toHaveTextContent("1,015");
    expect(stats).toHaveTextContent("851");
    expect(stats).toHaveTextContent("654");
    expect(await screen.findByText("Before 3:30 AM, about half the frames were lost")).toBeInTheDocument();
    expect(screen.getByText("Measured")).toBeInTheDocument();
    expect(screen.getByText("Heuristic")).toBeInTheDocument();
    const chart = await screen.findByRole("img", { name: /Frames per half hour/ });
    expect(chart.getAttribute("aria-label")).toMatch(/2 time bins/);
    expect(screen.getByRole("button", { name: "Re-read folder" })).toBeInTheDocument();
  });

  it("shows unknown kept with the reason, never 0, and surfaces the unmatched finding", async () => {
    run = {
      ...mkRun(),
      report: mkReport({
        totals: { captured: 10, aligned: 8, kept: null, captured_s: 100, aligned_s: 80, kept_s: null, matched: 7, unmatched: 3 },
        findings: [{ id: "unmatched", title: "3 of this folder's 10 frames don't match this night's imported frames", detail: "d", basis: "measured", heuristic: false }],
      }),
      folder: { run_dir: "process", kept_error: "Couldn't tell which frames were kept: no r_ file." },
    } as unknown as RunOut;
    renderPage();
    const stats = await screen.findByRole("group", { name: "Night totals" });
    expect(within(stats).getByText("unknown")).toBeInTheDocument();
    expect(await screen.findByText(/no r_ file/)).toBeInTheDocument();
    expect(screen.getByText(/3 of this folder's 10 frames/)).toBeInTheDocument();
  });

  it("uploads a picked folder and asks which run when there are two", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith("/siril-folder")) {
          bodies.push(JSON.parse(String(init?.body)));
          run = { ...run, report: mkReport() as unknown as RunOut["report"] };
        }
        return new Response(JSON.stringify(run), { status: 200 });
      }),
    );
    renderPage();
    const input = await screen.findByLabelText("Choose the night folder (the one containing lights/)");
    fireEvent.change(input, {
      target: {
        files: [
          textFile("Night/process/light_.seq", "A"),
          textFile("Night/process/light_conversion.txt", "B"),
          textFile("Night/process-coach/light_.seq", "C"),
          textFile("Night/flats/f.fit", "x"),
        ],
      },
    });
    const group = await screen.findByRole("radiogroup", { name: /Which Siril folder/ });
    expect(bodies).toHaveLength(0);
    fireEvent.click(within(group).getByRole("radio", { name: /process-coach/ }));
    fireEvent.click(screen.getByRole("button", { name: "Read this folder" }));
    await screen.findByRole("group", { name: "Night totals" });
    expect(bodies[0]).toEqual({ run_dir: "process-coach", files: [{ path: "process-coach/light_.seq", text: "C" }], calibration_dirs: ["flats"] });
  });

  it("shows the server's 422 message in an alert", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("/siril-folder")
          ? new Response(JSON.stringify({ detail: "This folder has no light_conversion.txt." }), { status: 422 })
          : new Response(JSON.stringify(run), { status: 200 }),
      ),
    );
    renderPage();
    const input = await screen.findByLabelText("Choose the night folder (the one containing lights/)");
    fireEvent.change(input, { target: { files: [textFile("Night/process/light_.seq", "A")] } });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This folder has no light_conversion.txt.");
  });

  it("explains when the folder has no Siril sequence", async () => {
    renderPage();
    const input = await screen.findByLabelText("Choose the night folder (the one containing lights/)");
    fireEvent.change(input, { target: { files: [textFile("Night/lights/a.fit", "x")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/no Siril/i);
  });
});
