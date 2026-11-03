import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ yAxis: null as null | Record<string, unknown> }));

vi.mock("recharts", async () => {
  const Box = ({ children }: { children?: import("react").ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Box,
    ComposedChart: Box,
    Scatter: () => null,
    Line: () => null,
    XAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
    YAxis: (p: Record<string, unknown>) => {
      captured.yAxis = p;
      return null;
    },
  };
});
vi.mock("../../state/prefs", () => ({ usePrefs: () => ({ prefs: { nightVision: false }, update: vi.fn() }) }));

import { LightCurve, curveYDomain } from "./LightCurve";
import { LightCurveSection } from "./LightCurveSection";
import type { CurveResponse } from "../../api/variables";

const curve = (over: Partial<CurveResponse> = {}): CurveResponse => ({
  window: { key: "recent", label: "Last 365 days", from_date: null, to_date: null },
  points: [[2461000.5, 9.1, "V"], [2461001.5, 8.7, "Vis."], [2461002.5, 12.0, "V"]],
  daily: [["2026-09-01", 9.1, 1], ["2026-09-02", 8.7, 1]],
  counts: { cached: 40, plotted_points: 3, every_nth: 3, included: 9 },
  bands_included: ["V", "Vis."],
  excluded_note: "Fainter-than estimates and other bands are not plotted.",
  status: { last_ok_utc: new Date(Date.now() - 2 * 3600_000).toISOString(), last_error: null, coverage_days: 365, target_days: 365, loading: false },
  attribution: ["Observations from the AAVSO International Database, contributed by observers worldwide. © AAVSO."],
  ...over,
});

let calls: string[];
let body: CurveResponse;
beforeEach(() => {
  calls = [];
  body = curve();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status: 200 });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  captured.yAxis = null;
});

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LightCurveSection slug="ss-cyg" nights={["2026-09-01"]} />
    </QueryClientProvider>,
  );
}

describe("curveYDomain", () => {
  it("pads the observed magnitudes, smaller (brighter) first", () => {
    expect(curveYDomain([9.1, 8.7, 12.0])).toEqual([8.4, 12.3]);
  });
  it("has a sane default when there is no data", () => {
    const [lo, hi] = curveYDomain([]);
    expect(lo).toBeLessThan(hi);
  });
});

describe("LightCurve chart", () => {
  it("reverses the Y axis and labels it brighter-is-up", () => {
    render(<LightCurve curve={curve()} nights={[]} />);
    expect(captured.yAxis?.reversed).toBe(true);
    expect(captured.yAxis?.domain).toEqual([8.4, 12.3]);
    expect((captured.yAxis?.label as { value: string }).value).toBe("Magnitude (V) · Brighter ↑");
    expect(screen.getByRole("figure")).toHaveAccessibleName(/brighter is up/i);
  });
});

describe("LightCurveSection", () => {
  it("renders the source line with counts, bands, exclusion note and attribution", async () => {
    renderSection();
    expect(await screen.findByText(/AAVSO International Database via VSX · 40 observations cached · 3 shown \(every 3rd\) · checked 2 h ago/)).toBeInTheDocument();
    expect(screen.getByText(/Bands shown: V, Vis\./)).toBeInTheDocument();
    expect(screen.getByText("Fainter-than estimates and other bands are not plotted.")).toBeInTheDocument();
    expect(screen.getByText(/Observations from the AAVSO International Database/)).toBeInTheDocument();
    expect(calls[0]).toContain("/api/variables/ss-cyg/curve?window=recent");
    expect(screen.queryByText(/Loading history/)).toBeNull();
  });

  it("shows loading progress and keeps polling every 5 s only while loading", async () => {
    body = curve({ status: { ...curve().status, loading: true, coverage_days: 120, target_days: 365 } });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderSection();
    expect(await screen.findByText("Loading history: 120/365 days")).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5100);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    body = curve();
    await vi.advanceTimersByTimeAsync(5100);
    await vi.waitFor(() => expect(screen.queryByText(/Loading history/)).toBeNull());
    const settled = calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls.length).toBe(settled);
  });

  it("stops polling after an error", async () => {
    body = curve({ status: { ...curve().status, loading: true } });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderSection();
    await screen.findByText(/Loading history/);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ detail: "boom" }), { status: 500 });
    }));
    await vi.advanceTimersByTimeAsync(5100);
    const n = calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.length).toBe(n);
  });

  it("says AAVSO is unreachable with the last successful check when a fetch failed", async () => {
    body = curve({ status: { ...curve().status, last_error: "timeout" } });
    renderSection();
    expect(await screen.findByText(/AAVSO unreachable \(timeout\)\. Last successful check 2 h ago/)).toBeInTheDocument();
  });
});
