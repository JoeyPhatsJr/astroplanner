import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import type { LibraryRow } from "../../api/astrolog";
import { authKey } from "../../api/auth";
import { createQueryClient } from "../../api/queryClient";
import type { Mission } from "../../api/variables";
import { loginHref } from "../../lib/returnTo";
import { DEFAULT_PREFS, PrefsProvider } from "../../state/prefs";
import { seedSignedIn, seedSignedOut } from "../../test/auth";
import { ScriptButton } from "../processing/ScriptButton";
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

/** One FITS file whose header is a single 2880-byte block ending in an END card. */
function fitsFile(name = "light_0001.fit") {
  const card = (s: string) => s.padEnd(80, " ");
  const header = (card("SIMPLE  =                    T") + card("END")).padEnd(2880, " ");
  const file = new File([header], name, { type: "application/fits" });
  Object.defineProperty(file, "webkitRelativePath", { value: `night/lights/${name}` });
  return file;
}

describe("401 from direct calls", () => {
  it("an import preview that 401s shows the gate, not an import error", async () => {
    handlers["GET /api/locations"] = () => json([place]);
    handlers["GET /api/equipment"] = () => json([]);
    handlers["GET /api/sessions"] = () => json([]);
    handlers["POST /api/astrolog/import/preview"] = () => json({ detail: "Sign in to continue." }, 401);
    const qc = renderApp("/astrolog/import", seedSignedIn);
    await waitFor(() => expect(document.getElementById("astrolog-folder")).not.toBeNull());
    const input = document.getElementById("astrolog-folder") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fitsFile()] } });
    expect(await screen.findByRole("heading", { level: 1, name: GATE })).toBeInTheDocument();
    expect(urls).toContain("/api/astrolog/import/preview");
    expect(qc.getQueryData(authKey)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Sign in to continue.")).toBeNull();
  });

  it("a script download that 401s signs out instead of showing the 401 text", async () => {
    handlers["GET /api/processing/runs/r1/scripts/prepare"] = () => json({ detail: "Sign in to continue." }, 401);
    const qc = createQueryClient();
    seedSignedIn(qc);
    render(
      <QueryClientProvider client={qc}>
        <ScriptButton runId="r1" which="prepare" disabledReason={null} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Download script 1 (prepare)" }));
    await waitFor(() => expect(qc.getQueryData(authKey)).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Sign in to continue/)).toBeNull();
    expect(screen.getByRole("button", { name: "Download script 1 (prepare)" })).toBeEnabled();
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

  it("a plan request that 401s mid-session shows the sign-in prompt, not an error", async () => {
    handlers["GET /api/locations"] = () => json([place]);
    handlers["GET /api/equipment"] = () => json([]);
    handlers["GET /api/tonight"] = () => json(tonight);
    handlers["GET /api/recommendations"] = () => json(recommendations);
    handlers["GET /api/astrolog/history"] = () => json({});
    handlers["GET /api/sessions"] = () => json({ detail: "Sign in to continue." }, 401);
    renderApp("/tonight", seedSignedIn);
    const plan = await screen.findByRole("region", { name: "Session plan" });
    expect(await within(plan).findByRole("link", { name: "Sign in to plan" })).toHaveAttribute("href", "/login?next=%2Ftonight");
    expect(urls.filter((u) => u.startsWith("/api/sessions"))).toHaveLength(1); // asked once signed in, never retried
    expect(within(plan).queryByRole("alert")).toBeNull();
    expect(within(plan).queryByText("Sign in to continue.")).toBeNull();
    expect(await screen.findByRole("link", { name: "Sign in to add Andromeda Galaxy to a session" })).toBeInTheDocument();
  });
});

describe("Personal progress after a 401", () => {
  it("a 401 mid-session on the star page removes the nights count and mission progress", async () => {
    let session = true; // what the server's cookie check would say
    const star = () => ({
      star: { id: "var:ss-cyg", name: "SS Cygni", primary_designation: "SS Cyg", category: "variable", kind: "variable", constellation: "Cygnus", ra_deg: 1, dec_deg: 2 },
      vsx: { max_mag: 7.7, min_mag: 12.4, band: "V", raw_range: [] },
      type_label: "Dwarf nova",
      period_note: null,
      source_url: "https://vsx.aavso.org/index.php?view=detail.top&oid=1",
      retrieved: "2026-11-02",
      attribution: [],
      nights: session ? ["2026-09-12", "2026-10-03"] : [],
      missions: [
        { key: "monthly", title: "Monthly visits", description: "Observe it once a month.", progress: session ? 2 : null, goal: 6, unit: "months" },
      ],
      seestar_fit: null,
    });
    handlers["GET /api/locations"] = () => json([place]);
    handlers["GET /api/equipment"] = () => json([]);
    handlers["GET /api/sessions"] = () => json([]);
    handlers["GET /api/variables/ss-cyg"] = () => json(star());
    handlers["GET /api/variables/ss-cyg/visibility"] = () =>
      json({
        computed_at_utc: "2026-11-02T20:00:00Z",
        star: {},
        visibility: {
          can_observe: true,
          status_text: "Observable",
          min_altitude_deg: 30,
          best_window: { start_utc: "2026-11-03T00:30:00Z", end_utc: "2026-11-03T05:30:00Z", minutes: 300 },
        },
        night: { timezone: "America/New_York" },
      });
    // The session has ended on the server: the next owned request answers 401.
    handlers["POST /api/sessions"] = () => {
      session = false;
      return json({ detail: "Sign in to continue." }, 401);
    };
    renderApp("/variables/ss-cyg", seedSignedIn);
    expect(await screen.findByText("2 of 6 months")).toBeInTheDocument();
    expect(screen.getByText("Your nights")).toBeInTheDocument();
    const add = await screen.findByRole("button", { name: "Add to tonight’s plan" });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    expect(await screen.findByRole("link", { name: "Sign in to add to session" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("2 of 6 months")).toBeNull());
    expect(screen.queryByText("Your nights")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("article", { name: "Mission: Monthly visits" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
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
