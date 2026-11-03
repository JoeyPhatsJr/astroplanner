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

import { LightCurve, curveYDomain, curveYTicks, dailyLineRows, timeTicks } from "./LightCurve";
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
  it("rounds outward to whole magnitudes, brighter first, with integer ticks", () => {
    expect(curveYDomain([8.43, 10, 12.6])).toEqual([8, 13]);
    expect(curveYTicks([8, 13])).toEqual([8, 9, 10, 11, 12, 13]);
  });
  it("has a sane default when there is no data", () => {
    const [lo, hi] = curveYDomain([]);
    expect(lo).toBeLessThan(hi);
  });
});

describe("daily line", () => {
  it("breaks between consecutive means more than 3 days apart", () => {
    const rows = dailyLineRows([["2026-01-01", 9, 1], ["2026-01-02", 9, 1], ["2026-01-10", 10, 1], ["2026-01-11", 10, 1]]);
    expect(rows.map((r) => r.mag)).toEqual([9, 9, null, 10, 10]);
    expect(dailyLineRows([["2026-01-01", 9, 1], ["2026-01-04", 9, 1]]).some((r) => r.mag === null)).toBe(false);
  });
});

describe("time ticks", () => {
  it("are first-of-month, ordered, with unique labels over a year", () => {
    const { ticks, label } = timeTicks(Date.parse("2025-11-10T00:00:00Z"), Date.parse("2026-11-02T00:00:00Z"));
    const labels = ticks.map(label);
    expect(new Set(labels).size).toBe(labels.length);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
    expect(ticks.every((t) => new Date(t).getUTCDate() === 1)).toBe(true);
  });
  it("uses unique day labels over a short span", () => {
    const { ticks, label } = timeTicks(Date.parse("1946-02-01T00:00:00Z"), Date.parse("1946-02-20T00:00:00Z"));
    const labels = ticks.map(label);
    expect(labels.length).toBeGreaterThan(1);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("LightCurve chart", () => {
  it("reverses the Y axis and labels it brighter-is-up", () => {
    render(<LightCurve curve={curve()} nights={[]} />);
    expect(captured.yAxis?.reversed).toBe(true);
    expect(captured.yAxis?.domain).toEqual([8, 12]);
    expect((captured.yAxis?.label as { value: string }).value).toBe("Magnitude (V) · Brighter ↑");
    expect(screen.getByRole("figure")).toHaveAccessibleName(/brighter is up/i);
  });
});

describe("LightCurveSection", () => {
  it("renders the source line with counts, bands, exclusion note and attribution", async () => {
    renderSection();
    expect(await screen.findByText(/AAVSO International Database via VSX · 40 observations cached · 3 shown \(every 3rd\) · checked 2 h ago/)).toBeInTheDocument();
    expect(screen.getByText(/^Bands shown: V, Vis\. Fainter-than estimates and other bands are not plotted\.$/)).toBeInTheDocument();
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
