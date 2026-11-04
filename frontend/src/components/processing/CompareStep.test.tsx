import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompareMeasurement, ComparisonOut, ComparisonStack, RunOut } from "../../api/processing";
import { CompareStep } from "./CompareStep";

const meas = (over: Partial<CompareMeasurement> = {}): CompareMeasurement => ({
  width: 1080,
  height: 1920,
  bayer: null,
  stack_count: 654,
  livetime_s: 6540,
  star_fwhm_px: 2.7,
  stars_measured: 120,
  noise_frac: 0.0405,
  method: "coach-measure-2",
  ...over,
});
const stack = (name: string, over: Partial<CompareMeasurement> = {}): ComparisonStack => ({
  preview_url: `/api/processing/runs/r1/images/${name}`,
  source_filename: name,
  measurement: meas(over),
});
const EMPTY: ComparisonOut = {
  mode_available: { pictures: false, stacks: false },
  seestar_picture: null,
  final_picture: null,
  siril_stack: null,
  seestar_stack: null,
};
const PICTURES: ComparisonOut = {
  ...EMPTY,
  mode_available: { pictures: true, stacks: false },
  seestar_picture: {
    preview_url: "/api/processing/runs/r1/images/p.jpg",
    source_filename: "seestar_photo.jpg",
    width: 665,
    height: 1182,
    edited: true,
    edited_by: "Adobe Lightroom 11.5.21 (iOS)",
  },
  final_picture: {
    id: "f1",
    source_filename: "my_final.jpg",
    format: "JPEG",
    width: 1080,
    height: 1920,
    preview_url: "/api/astrolog/images/f1/preview",
  },
};
const STACKS: ComparisonOut = {
  ...EMPTY,
  mode_available: { pictures: false, stacks: true },
  siril_stack: stack("siril.fit"),
  seestar_stack: stack("seestar.fit", { bayer: null, stack_count: 120, star_fwhm_px: 3.1 }),
};

const mkRun = (compare: ComparisonOut): RunOut =>
  ({
    id: "r1",
    capture_set_id: "cs1",
    target: { id: "t1", name: "Bubble Nebula" },
    night: { session_id: "s1", night_date: "2026-09-11", timezone: "America/Denver" },
    frames: 100,
    exptime_s: 10,
    steps: [],
    report: null,
    selection: [],
    comparison: {},
    compare,
    siril_target: "1.4.5",
  }) as RunOut;

let calls: { url: string; method: string; body: unknown }[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
      return new Response(JSON.stringify(mkRun(EMPTY)), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderStep(compare: ComparisonOut) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CompareStep run={mkRun(compare)} />
    </QueryClientProvider>,
  );
}

const panel = (name: RegExp) => screen.getByRole("group", { name });

describe("Compare step: final pictures", () => {
  it("opens on pictures when both exist and shows no numbers except size, edited status and file names", () => {
    const { container } = renderStep(PICTURES);
    expect(screen.getByRole("button", { name: "Final pictures" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Stacks (measured)" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByAltText(/Seestar picture/)).toBeInTheDocument();
    expect(screen.getByAltText(/your final picture/i)).toBeInTheDocument();
    expect(screen.getByText(/665 × 1182/)).toBeInTheDocument();
    expect(screen.getByText(/Adobe Lightroom 11\.5\.21 \(iOS\)/)).toBeInTheDocument();
    let text = container.textContent ?? "";
    for (const allowed of ["665 × 1182", "1080 × 1920", "Adobe Lightroom 11.5.21 (iOS)"]) text = text.replace(allowed, "");
    expect(text).not.toMatch(/\d/);
    expect(screen.queryByText(/^(Frames|Total exposure|Star size|Background noise)/)).toBeNull();
  });

  it("says unknown when the picture does not say it was edited, and lets the user set it", async () => {
    renderStep({ ...PICTURES, seestar_picture: { ...PICTURES.seestar_picture!, edited: null, edited_by: null } });
    expect(within(panel(/Seestar/)).getByText(/Unknown/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edited" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")).toBeTruthy());
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toContain("/api/processing/runs/r1");
    expect(JSON.parse(String(patch.body))).toEqual({ comparison: { seestar_picture: { edited: true } } });
  });

  it("shows an empty state with a real file input for each missing picture", async () => {
    renderStep(EMPTY);
    const final = screen.getByLabelText("Add your final picture") as HTMLInputElement;
    expect(final.type).toBe("file");
    fireEvent.change(final, { target: { files: [new File(["x"], "final.jpg")] } });
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/api/astrolog/targets/t1/final-image"))).toBe(true));
    const pic = screen.getByLabelText("Add Seestar picture") as HTMLInputElement;
    expect(pic.type).toBe("file");
    expect(pic.accept).toContain(".jpg");
    fireEvent.change(pic, { target: { files: [new File(["x"], "seestar.jpg")] } });
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/api/processing/runs/r1/pictures/seestar"))).toBe(true));
    expect((calls.find((c) => c.url.endsWith("/pictures/seestar"))!.body as FormData).get("file")).toBeInstanceOf(File);
  });
});

describe("Compare step: stacks (measured)", () => {
  const rowLabels = (el: HTMLElement) => within(el).getAllByRole("term").map((t) => t.textContent);

  it("shows identical row labels for both sides, with the measurement wording", () => {
    renderStep(STACKS);
    expect(screen.getByRole("button", { name: "Stacks (measured)" })).toHaveAttribute("aria-pressed", "true");
    const siril = panel(/Siril stack/);
    const seestar = panel(/Seestar stack/);
    expect(rowLabels(siril)).toEqual(rowLabels(seestar));
    expect(rowLabels(siril)).toEqual(["Frames", "Total exposure", "Star size (FWHM)", "Background noise (relative, same method)"]);
    expect(within(siril).getByText("654")).toBeInTheDocument();
    expect(within(siril).getByText("1 h 49 m")).toBeInTheDocument();
    expect(within(seestar).getByText("120")).toBeInTheDocument();
    expect(screen.getAllByText(/of the image's brightness range/).length).toBe(2);
    expect(screen.queryByText(/sky level/i)).toBeNull();
    expect(screen.getByAltText(/Siril stack/)).toBeInTheDocument();
    expect(screen.getByAltText(/Seestar stack/)).toBeInTheDocument();
  });

  it('shows "—" and "not in file" where a header lacks the value, the same way on both sides', () => {
    renderStep({ ...STACKS, seestar_stack: stack("seestar.fit", { stack_count: null, livetime_s: null }) });
    const seestar = panel(/Seestar stack/);
    expect(within(seestar).getAllByText(/not in file/).length).toBe(2);
    expect(within(seestar).getAllByText("—").length).toBe(2);
    expect(within(panel(/Siril stack/)).queryByText(/not in file/)).toBeNull();
  });

  it("notes next to the noise row that a super-pixelled Bayer stack and a debayered one are not comparable", () => {
    renderStep({ ...STACKS, seestar_stack: stack("seestar.fit", { bayer: "RGGB" }) });
    for (const p of [panel(/Siril stack/), panel(/Seestar stack/)])
      expect(within(p).getByRole("note")).toHaveTextContent(/not comparable/i);
  });

  it("has no binning note when both sides are measured the same way", () => {
    renderStep(STACKS);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("shows the empty state with a real FITS input for the missing Seestar stack", async () => {
    renderStep({ ...STACKS, seestar_stack: null, mode_available: { pictures: false, stacks: false } });
    fireEvent.click(screen.getByRole("button", { name: "Stacks (measured)" }));
    const input = screen.getByLabelText("Add Seestar FITS stack") as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.accept).toBe(".fit,.fits,.fts");
    fireEvent.change(input, { target: { files: [new File(["x"], "Stacked.fit")] } });
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/api/processing/runs/r1/stacks/seestar"))).toBe(true));
  });

  it("offers the Siril stack upload when that side is missing", () => {
    renderStep({ ...STACKS, siril_stack: null });
    expect(screen.getByLabelText("Add your Siril stack (FITS)")).toBeInTheDocument();
  });
});

describe("Compare step: no verdicts", () => {
  it("never says winner, better or score, in either mode or when empty", () => {
    for (const c of [EMPTY, PICTURES, STACKS]) {
      const { unmount } = renderStep(c);
      expect(screen.queryByText(/winner|better|score/i)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Final pictures" }));
      expect(screen.queryByText(/winner|better|score/i)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Stacks (measured)" }));
      expect(screen.queryByText(/winner|better|score/i)).toBeNull();
      unmount();
    }
  });

  it("switches modes with the segmented buttons", () => {
    renderStep(STACKS);
    fireEvent.click(screen.getByRole("button", { name: "Final pictures" }));
    expect(screen.getByRole("button", { name: "Final pictures" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Frames")).toBeNull();
  });
});
