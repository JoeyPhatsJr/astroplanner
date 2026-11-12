import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunOut, StepView } from "../../api/processing";
import { ProcessingCoachPage } from "../../pages/ProcessingCoachPage";
import { PrefsProvider } from "../../state/prefs";
import { seedSignedIn } from "../../test/auth";

const IDS = ["report", "convert", "align", "select", "stack", "background", "colour", "stretch", "finish", "compare"] as const;
const PROMPT = "Add your Siril stack to get advice for this night";

const mkRun = (withStack: boolean): RunOut => ({
  id: "r1",
  capture_set_id: "cs1",
  target: { id: "t1", name: "Bubble Nebula" },
  night: { session_id: "s1", night_date: "2026-09-11", timezone: "America/Denver" },
  frames: 100,
  exptime_s: 10,
  steps: IDS.map((id, i): StepView => ({
    id,
    n: i + 1,
    title: id === "background" ? "Background" : id,
    does: `What ${id} does`,
    advice: [],
    gui: `Click ${id}`,
    command: null,
    expect: null,
    state: i < 5 ? "done" : "todo",
    blocked: null,
    prompt: !withStack && ["background", "colour", "stretch"].includes(id) ? PROMPT : null,
  })),
  report: null,
  selection: [],
  comparison: {
    mode_available: { pictures: false, stacks: false },
    seestar_picture: null,
    final_picture: null,
    seestar_stack: null,
    siril_stack: withStack
      ? {
          preview_url: "/api/processing/runs/r1/images/a",
          source_filename: "my_stack.fit",
          measurement: {
            width: 1080, height: 1920, bayer: null, stack_count: 654, livetime_s: 6540,
            star_fwhm_px: 2.2, stars_measured: 100, noise_frac: 0.04, method: "coach-measure-2",
          },
        }
      : null,
  },
  siril_target: "1.4.5",
});

let run: RunOut;
let posts: { url: string; body: unknown }[];
let postResponse: () => Response;

beforeEach(() => {
  run = mkRun(false);
  posts = [];
  postResponse = () => new Response(JSON.stringify((run = mkRun(true))), { status: 200 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST" && String(url).includes("/stacks/")) {
        posts.push({ url: String(url), body: init?.body });
        return postResponse();
      }
      return new Response(JSON.stringify(run), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seedSignedIn(qc); // the coach is behind the account gate
  return render(
    <PrefsProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/astrolog/process/cs1"]}>
          <Routes>
            <Route path="/astrolog/process/:captureSetId" element={<ProcessingCoachPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </PrefsProvider>,
  );
}

describe("Siril stack upload on steps 6-8", () => {
  it("shows the prompt and a labelled upload, posts the file to the siril side, then shows what was measured", async () => {
    renderPage();
    await screen.findByText("Step 6 of 10");
    expect(screen.getByText(PROMPT)).toBeInTheDocument();
    const input = screen.getByLabelText("Add your Siril stack (FITS)") as HTMLInputElement;
    expect(input).toHaveAttribute("accept", ".fit,.fits,.fts");
    const file = new File([new Uint8Array(4)], "my_stack.fit");
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toContain("/api/processing/runs/r1/stacks/siril");
    expect((posts[0].body as FormData).get("file")).toBeInstanceOf(File);
    expect(await screen.findByText(/Measured my_stack\.fit \(1080 x 1920 px\)/)).toBeInTheDocument();
    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Replace your Siril stack (FITS)")).toBeInTheDocument();
  });

  it("keeps the file input directly before its label so the focus ring (peer-focus-visible) can reach it", async () => {
    renderPage();
    await screen.findByText("Step 6 of 10");
    const input = screen.getByLabelText("Add your Siril stack (FITS)");
    expect(input).toHaveClass("peer");
    expect(input.nextElementSibling).toHaveAttribute("for", "coach-siril-stack");
    expect(input.nextElementSibling?.className).toContain("peer-focus-visible:outline");
  });

  it("shows the server's message when the stack is rejected", async () => {
    postResponse = () => new Response(JSON.stringify({ detail: "Stacks must be FITS files" }), { status: 422 });
    renderPage();
    await screen.findByText("Step 6 of 10");
    fireEvent.change(screen.getByLabelText("Add your Siril stack (FITS)"), { target: { files: [new File(["x"], "a.jpg")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Stacks must be FITS files");
  });
});
