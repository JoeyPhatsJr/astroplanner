import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import type { LibraryRow } from "../../api/astrolog";
import { createQueryClient } from "../../api/queryClient";
import type { Mission } from "../../api/variables";
import { loginHref } from "../../lib/returnTo";
import { DEFAULT_PREFS, PrefsProvider } from "../../state/prefs";
import { seedSignedIn, seedSignedOut } from "../../test/auth";
import { ConfirmProvider } from "../ui/ConfirmDialog";
import { MissionCard } from "../variables/MissionCard";

// The strip and score have their own tests; here only the plan prompts matter.
vi.mock("../tonight/NightStrip", () => ({ NightStrip: () => <div data-testid="strip" /> }));
vi.mock("../tonight/ScoreHero", () => ({ ScoreHero: () => <div data-testid="score" /> }));

const GATE = "Your nights live in your account.";

type Handler = () => Response;
let handlers: Record<string, Handler>;
let urls: string[];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  handlers = {};
  urls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url);
      const h = handlers[`${init?.method ?? "GET"} ${url.split("?")[0]}`];
      return h ? h() : json({ detail: "Not found." }, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderApp(path: string, setup: (qc: QueryClient) => void) {
  const qc = createQueryClient();
  setup(qc);
  render(
    <QueryClientProvider client={qc}>
      <PrefsProvider initial={DEFAULT_PREFS}>
        <ConfirmProvider>
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>
        </ConfirmProvider>
      </PrefsProvider>
    </QueryClientProvider>,
  );
  return qc;
}

const owned = (u: string) => ["/api/astrolog", "/api/sessions", "/api/processing"].some((p) => u.startsWith(p));

const row: LibraryRow = {
  id: "t1",
  display_name: "Bubble Nebula",
  kind: "catalog",
  catalog_target_id: "ngc7635",
  custom_name: null,
  category: "nebula",
  thumb_url: null,
  headline: { seconds: 6540, label: "stack", provenance: "Siril", basis: "linked" },
  captured_s: 7200,
  nights: 2,
} as LibraryRow;

describe("AstroLog gate", () => {
  it("signed out, every AstroLog route shows the gate", async () => {
    for (const path of ["/astrolog", "/astrolog/import", "/astrolog/nights", "/astrolog/targets/t1", "/astrolog/process/c1"]) {
      renderApp(path, seedSignedOut);
      const main = screen.getByRole("main");
      expect(await within(main).findByRole("heading", { level: 1, name: GATE })).toBeInTheDocument();
      expect(within(main).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", loginHref(path));
      expect(within(main).getByRole("link", { name: "Create an account" })).toHaveAttribute(
        "href",
        `/signup?next=${encodeURIComponent(path)}`,
      );
      const works = within(main).getByRole("list", { name: "Works without an account" });
      expect(within(works).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
        "Tonight’s sky and score",
        "Explore and target details",
        "Variable Hunter star pages",
      ]);
      // The sidebar says AstroLog needs an account (visible tag "Account", hidden from the accessible name).
      const sidebar = screen.getByRole("complementary", { name: "Primary" });
      expect(within(sidebar).getByRole("link", { name: "AstroLog needs an account" })).toHaveAttribute("href", "/astrolog");
      cleanup();
    }
    expect(loginHref("/astrolog/import")).toBe("/login?next=%2Fastrolog%2Fimport");
    expect(urls.filter(owned)).toEqual([]);
  });

  it("signed in, the library renders", async () => {
    handlers["GET /api/astrolog/library"] = () => json([row]);
    renderApp("/astrolog", seedSignedIn);
    const list = await screen.findByRole("list", { name: "Library targets" });
    expect(within(list).getByText("Bubble Nebula")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: GATE })).toBeNull();
    const sidebar = screen.getByRole("complementary", { name: "Primary" });
    expect(within(sidebar).getByRole("link", { name: "AstroLog" })).toBeInTheDocument();
  });

  it("401 mid-session shows the gate", async () => {
    handlers["GET /api/astrolog/library"] = () => json({ detail: "Sign in to continue." }, 401);
    renderApp("/astrolog", seedSignedIn);
    expect(await screen.findByRole("heading", { level: 1, name: GATE })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your library")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

const place = {
  id: "l1",
  label: "Backyard",
  latitude_deg: 40,
  longitude_deg: -75,
  elevation_m: 0,
  timezone: "America/New_York",
  is_sample: false,
};
const tonight = {
  night: {
    timezone: "America/New_York",
    display_start_utc: "2026-11-03T22:00:00Z",
    has_darkness: true,
    darkness: "astronomical",
    darkness_threshold_deg: -18,
    dark_minutes: 600,
    sun_min_alt_deg: -50,
    dark_intervals: [{ start_utc: "2026-11-03T23:45:00Z", end_utc: "2026-11-04T09:45:00Z" }],
    moon: { illumination: 0.5, up_fraction_of_dark: 0 },
    series: { t_ms: [], sun_alt_deg: [], moon_alt_deg: [], moon_illumination: [] },
    notes: [],
  },
  forecast: { status: "unavailable", message: "No forecast", hourly: [], missing: {} },
  score: { status: "no_weather", total: null, window: null, components: [], darkness: "astronomical" },
  night_clear: null,
};
const recommendations = {
  has_darkness: true,
  observable_count: 1,
  weather_status: "ok",
  weather_message: null,
  results: [
    {
      target: { id: "M31", name: "Andromeda Galaxy", primary_designation: "M31", kind: "Galaxy", constellation: "Andromeda", angular_major_arcmin: 190, angular_minor_arcmin: 60 },
      visibility: {
        status: "observable",
        status_text: "Observable",
        status_detail: "",
        can_observe: true,
        best_window: { start_utc: "2026-11-04T00:00:00Z", end_utc: "2026-11-04T04:00:00Z", minutes: 240 },
        observable_minutes: 240,
        max_alt_dark_deg: 80,
      },
      score: { total: 70, max_total: 100, why: [], cautions: [], forecast_window: null },
      sparkline_alt_deg: [10, 40, 70],
    },
  ],
};

describe("Tonight signed out", () => {
  it("Tonight signed out asks to sign in for plans", async () => {
    handlers["GET /api/locations"] = () => json([place]);
    handlers["GET /api/equipment"] = () => json([]);
    handlers["GET /api/tonight"] = () => json(tonight);
    handlers["GET /api/recommendations"] = () => json(recommendations);
    renderApp("/tonight", seedSignedOut);
    const plan = await screen.findByRole("region", { name: "Session plan" });
    expect(await within(plan).findByText("Session plans are saved with your account.")).toBeInTheDocument();
    expect(within(plan).getByRole("link", { name: "Sign in to plan" })).toHaveAttribute("href", "/login?next=%2Ftonight");
    const add = await screen.findByRole("link", { name: "Sign in to add Andromeda Galaxy to a session" });
    expect(add).toHaveAttribute("href", "/login?next=%2Ftonight");
    expect(urls.some((u) => u.startsWith("/api/sessions"))).toBe(false);
    expect(urls.some((u) => u.startsWith("/api/astrolog/history"))).toBe(false);
  });
});

describe("Mission progress", () => {
  const mission: Mission = { key: "monthly", title: "Monthly visits", description: "Observe it each month.", progress: 2, goal: 6, unit: "months" };

  it("mission progress hidden signed out", () => {
    const { unmount } = render(<MissionCard mission={{ ...mission, progress: null }} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/months/)).toBeNull();
    unmount();
    render(<MissionCard mission={mission} />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByText("2 of 6 months")).toBeInTheDocument();
  });
});
