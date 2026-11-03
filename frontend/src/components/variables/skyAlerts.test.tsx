import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  observer: { lat: 40, lon: -75, elevation_m: 0, date: "2026-11-02", timezone: "America/New_York" } as unknown,
}));

vi.mock("../../api/hooks", async (orig) => {
  const mod = await orig<typeof import("../../api/hooks")>();
  return {
    ...mod,
    useObserver: () => mocks.observer,
    useCurrentLocation: () => ({
      location: { id: "l1", label: "Home", latitude_deg: 40, longitude_deg: -75, elevation_m: 0, timezone: "America/New_York", is_sample: false },
      isLoading: false, error: null, refetch: vi.fn(),
    }),
    useNightDate: () => ({ nightDate: "2026-11-02", isAuto: false }),
    useTonight: () => ({ data: undefined, isLoading: false, error: null, isFetching: false, refetch: vi.fn() }),
    useRecommendations: () => ({ data: undefined, isLoading: false, error: null, isFetching: false, refetch: vi.fn() }),
  };
});
vi.mock("../../state/prefs", () => ({
  usePrefs: () => ({ prefs: { minAltitudeDeg: 30, darkness: "astronomical", nightDate: "2026-11-02", nightVision: false }, update: vi.fn() }),
}));
vi.mock("../../state/activeSession", () => ({
  useActiveSession: () => ({ inSession: () => false, isAdding: false, error: null, addTarget: vi.fn() }),
}));
vi.mock("../layout/HeaderControls", () => ({ HeaderControls: () => null }));
vi.mock("../session/SessionPlanPanel", () => ({ SessionPlanPanel: () => <div>plan panel</div> }));
vi.mock("../targets/TargetDetail", () => ({ TargetDetail: () => null }));

import { AppShell } from "../layout/AppShell";
import { TonightPage } from "../../pages/TonightPage";
import { SkyAlertsCard } from "./SkyAlertsCard";

const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const vis = (best: boolean) => ({
  can_observe: best, status_text: "Below the horizon all night", min_altitude_deg: 30,
  best_window: best ? { start_utc: "2026-11-03T00:30:00Z", end_utc: "2026-11-03T05:30:00Z", minutes: 300 } : null,
});
const row = (over: Record<string, unknown>) => ({
  star_id: "var:ss-cyg", slug: "ss-cyg", name: "SS Cygni", state: "alert",
  evidence: { observers: 3, threshold: 10, window_hours: 48, brightest: 8.5 },
  current_mag: 8.6, normal_text: "usually near 12", checked_utc: ago(2), last_error: null, visibility: vis(true), ...over,
});
const body = (alerts: unknown[], over: Record<string, unknown> = {}) => ({
  enabled: true, alerts, dot: alerts.some((a) => (a as { state: string }).state === "alert"),
  attribution: ["Observations from the AAVSO International Database, contributed by observers worldwide. © AAVSO."], ...over,
});

let alertsBody: unknown;
let calls: { url: string; method: string }[];
beforeEach(() => {
  calls = [];
  alertsBody = body([row({})]);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.startsWith("/api/variables/alerts")) return new Response(JSON.stringify(alertsBody), { status: 200 });
    if (url.endsWith("/alerts/dismiss")) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ detail: "no mock" }), { status: 500 });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Sky alerts card", () => {
  it("shows an alert row with window, evidence and attribution, and Dismiss calls the endpoint", async () => {
    wrap(<SkyAlertsCard />);
    expect(await screen.findByText(/in outburst · ~8\.6 V/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "SS Cygni" })).toHaveAttribute("href", "/variables/ss-cyg");
    expect(screen.getByText(/up .*–.*/)).toBeInTheDocument();
    expect(screen.getByText(/3 observers reported it brighter than 10 in the last 48 h · AAVSO, checked 2 h ago/)).toBeInTheDocument();
    expect(screen.getByText(/Observations from the AAVSO International Database/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss SS Cygni alert" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/api/variables/ss-cyg/alerts/dismiss")).toBe(true));
  });

  it("says 'below 30° tonight' when an alerting star is not up", async () => {
    alertsBody = body([row({ visibility: vis(false) })]);
    wrap(<SkyAlertsCard />);
    expect(await screen.findByText("below 30° tonight")).toBeInTheDocument();
  });

  it("renders no_change as 'no change · mag V' without a Dismiss button", async () => {
    alertsBody = body([row({ state: "no_change", visibility: null, current_mag: 10.4, name: "T Coronae Borealis", slug: "t-crb" })]);
    wrap(<SkyAlertsCard />);
    expect(await screen.findByText(/no change · 10\.4 V/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dismiss/ })).toBeNull();
  });

  it("labels a stale row stale, with the last data, and never 'no change'", async () => {
    alertsBody = body([row({ state: "stale", visibility: null, checked_utc: ago(30), last_error: "timeout", evidence: { observers: 2, threshold: 10, window_hours: 48, brightest: 9 } })]);
    const { container } = wrap(<SkyAlertsCard />);
    expect(await screen.findByText(/Stale · AAVSO last checked 1 d ago \(timeout\)/)).toBeInTheDocument();
    expect(screen.getByText(/last data showed 2 observers brighter than 10/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/no change/i);
    expect(screen.queryByRole("button", { name: /Dismiss/ })).toBeNull();
  });

  it("omits the last-data clause for a stale row with no bright observers", async () => {
    alertsBody = body([row({ state: "stale", visibility: null, last_error: null, evidence: { observers: 0, threshold: 10, window_hours: 48, brightest: null } })]);
    wrap(<SkyAlertsCard />);
    await screen.findByText(/Stale · AAVSO last checked/);
    expect(screen.queryByText(/last data showed/)).toBeNull();
  });

  it("says 'No AAVSO data yet' for unavailable", async () => {
    alertsBody = body([row({ state: "unavailable", visibility: null, checked_utc: null, current_mag: null })]);
    wrap(<SkyAlertsCard />);
    expect(await screen.findByText(/No AAVSO data yet/)).toBeInTheDocument();
  });

  it("is absent when AAVSO is off", async () => {
    alertsBody = { enabled: false, alerts: [], dot: false };
    const { container } = wrap(<SkyAlertsCard />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
  });
});

describe("Menu dot", () => {
  const dots = () => screen.queryAllByLabelText("Variable Hunter, new sky alert");

  it("appears on both navs only when dot is true", async () => {
    wrap(<AppShell>content</AppShell>);
    await waitFor(() => expect(dots()).toHaveLength(2));
  });

  it("is absent when dot is false", async () => {
    alertsBody = body([row({ state: "no_change", visibility: null })]);
    wrap(<AppShell>content</AppShell>);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(dots()).toHaveLength(0);
  });
});

describe("Opening the app never fetches a light curve", () => {
  it("Tonight + nav with AAVSO on request /alerts but no /curve", async () => {
    wrap(
      <AppShell>
        <TonightPage />
      </AppShell>,
    );
    await screen.findByText(/in outburst/);
    await waitFor(() => expect(screen.queryAllByLabelText("Variable Hunter, new sky alert")).toHaveLength(2));
    expect(within(document.body).getByText("plan panel")).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith("/api/variables/alerts"))).toBe(true);
    expect(calls.filter((c) => c.url.includes("/curve"))).toEqual([]);
  });
});
