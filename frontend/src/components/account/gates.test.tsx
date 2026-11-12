import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import type { LibraryRow } from "../../api/astrolog";
import { authKey } from "../../api/auth";
import { createQueryClient } from "../../api/queryClient";
import type { Mission } from "../../api/variables";
import { loginHref } from "../../lib/returnTo";
import { DEFAULT_PREFS, PrefsProvider } from "../../state/prefs";
import { seedSignedIn, seedSignedOut, TEST_ME } from "../../test/auth";
import { ScriptButton } from "../processing/ScriptButton";
import { TargetDetail } from "../targets/TargetDetail";
import { ConfirmProvider } from "../ui/ConfirmDialog";
import { MissionCard } from "../variables/MissionCard";

// The strip and score have their own tests; here only the plan prompts matter.
vi.mock("../tonight/NightStrip", () => ({ NightStrip: () => <div data-testid="strip" /> }));
vi.mock("../tonight/ScoreHero", () => ({ ScoreHero: () => <div data-testid="score" /> }));
vi.mock("../charts/LazyCharts", () => ({ AltitudeChart: () => <div data-testid="altitude-chart" /> }));

const GATE = "Your nights live in your account.";

type Handler = () => Response | Promise<Response>;
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

describe("the account check fails (backend down or reloading)", () => {
  const CHECK_FAILED = "Couldn’t check your account";
  const down = () => json({ detail: "Backend unavailable." }, 503);

  it("AstroLog shows the error with a retry, not the signed-out screen, and the header shows no Sign in", async () => {
    handlers["GET /api/auth/me"] = down;
    renderApp("/astrolog", () => {});
    const main = screen.getByRole("main");
    const alert = await within(main).findByRole("alert");
    expect(within(alert).getByText(CHECK_FAILED)).toBeInTheDocument();
    expect(within(alert).getByText("Backend unavailable.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: GATE })).toBeNull();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(urls.filter(owned)).toEqual([]);
    // Try again asks once more; this time the answer is "signed out", so the gate shows.
    handlers["GET /api/auth/me"] = () => json({ detail: "Sign in to continue." }, 401);
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await within(main).findByRole("heading", { level: 1, name: GATE })).toBeInTheDocument();
    expect(urls.filter((u) => u === "/api/auth/me")).toHaveLength(2);
  });

  it("the Account page shows the error, not a trip to sign in", async () => {
    handlers["GET /api/auth/me"] = down;
    renderApp("/account", () => {});
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(CHECK_FAILED)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Welcome back." })).toBeNull();
    handlers["GET /api/auth/me"] = () => json({ email: "owner@example.com", created_at: "2026-11-11T12:00:00Z", claimed_existing: false });
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("owner@example.com", { selector: "dd" })).toBeInTheDocument();
  });

  it("Tonight’s plan panel shows the error and Add stays disabled", async () => {
    handlers["GET /api/auth/me"] = down;
    handlers["GET /api/locations"] = () => json([place]);
    handlers["GET /api/equipment"] = () => json([]);
    handlers["GET /api/tonight"] = () => json(tonight);
    handlers["GET /api/recommendations"] = () => json(recommendations);
    renderApp("/tonight", () => {});
    const plan = await screen.findByRole("region", { name: "Session plan" });
    expect(await within(plan).findByText(CHECK_FAILED)).toBeInTheDocument();
    expect(within(plan).queryByRole("link", { name: "Sign in to plan" })).toBeNull();
    expect(await screen.findByRole("button", { name: "Add Andromeda Galaxy to session" })).toBeDisabled();
    expect(urls.some((u) => u.startsWith("/api/sessions"))).toBe(false);
  });

  const REASON = "Couldn’t check your account.";
  const meCalls = () => urls.filter((u) => u === "/api/auth/me");
  /** The next /me answer waits until the test releases it. */
  function holdMe() {
    let release!: (r: Response) => void;
    handlers["GET /api/auth/me"] = () => new Promise<Response>((r) => (release = r));
    return (r: Response) => release(r);
  }
  const describedBy = (el: HTMLElement) => (el.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);

  it("the star page says why Add is off, retries in place and keeps focus, then Add works", async () => {
    handlers["GET /api/auth/me"] = down;
    handlers["GET /api/locations"] = () => json([place]);
    handlers["GET /api/equipment"] = () => json([]);
    handlers["GET /api/variables/ss-cyg"] = () => json(starFixture);
    handlers["GET /api/variables/ss-cyg/visibility"] = () => json(starVisibility);
    renderApp("/variables/ss-cyg", () => {});
    const reason = await screen.findByText(REASON);
    const add = screen.getByRole("button", { name: "Add to tonight’s plan" });
    expect(add).toBeDisabled();
    expect(reason.id).not.toBe("");
    expect(describedBy(add)).toContain(reason.id);
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(urls.filter(owned)).toEqual([]);

    // While the second check is in flight the button stays, labelled, with focus on it; a second press asks nothing.
    const release = holdMe();
    handlers["GET /api/sessions"] = () => json([]);
    const user = userEvent.setup();
    await user.click(retry);
    await waitFor(() => expect(meCalls()).toHaveLength(2));
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveAccessibleName("Try again");
    expect(retry).toHaveAttribute("aria-disabled", "true");
    expect(retry).toHaveFocus();
    await user.click(retry);
    expect(meCalls()).toHaveLength(2);
    expect(urls.filter(owned)).toEqual([]);

    release(json(TEST_ME));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add to tonight’s plan" })).toBeEnabled());
    expect(screen.queryByText(REASON)).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add to tonight’s plan" })).toHaveFocus());
    expect(meCalls()).toHaveLength(2);
  });

  it("the star page: a retry that answers signed out shows Sign in to add, with focus on it", async () => {
    handlers["GET /api/auth/me"] = down;
    handlers["GET /api/locations"] = () => json([place]);
    handlers["GET /api/equipment"] = () => json([]);
    handlers["GET /api/variables/ss-cyg"] = () => json(starFixture);
    handlers["GET /api/variables/ss-cyg/visibility"] = () => json(starVisibility);
    renderApp("/variables/ss-cyg", () => {});
    await screen.findByText(REASON);
    handlers["GET /api/auth/me"] = () => json({ detail: "Sign in to continue." }, 401);
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    const link = await screen.findByRole("link", { name: "Sign in to add to session" });
    await waitFor(() => expect(link).toHaveFocus());
    expect(meCalls()).toHaveLength(2);
    expect(urls.filter(owned)).toEqual([]);
  });

  it("Explore’s target sheet says why Add is off and retries the check; signed in, Add works", async () => {
    handlers["GET /api/auth/me"] = down;
    handlers["GET /api/locations"] = () => json([place]);
    handlers["GET /api/equipment"] = () => json([]);
    handlers["GET /api/targets/M31/visibility"] = () => json(targetVisibility);
    renderDetail("M31");
    const sheet = await screen.findByRole("dialog");
    const reason = await within(sheet).findByText(REASON);
    const add = await within(sheet).findByRole("button", { name: "Add to session" });
    expect(add).toBeDisabled();
    expect(describedBy(add)).toContain(reason.id);
    expect(urls.filter(owned)).toEqual([]);

    const release = holdMe();
    handlers["GET /api/sessions"] = () => json([]);
    const user = userEvent.setup();
    const retry = within(sheet).getByRole("button", { name: "Try again" });
    await user.click(retry);
    await waitFor(() => expect(meCalls()).toHaveLength(2));
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute("aria-disabled", "true");
    expect(urls.filter(owned)).toEqual([]);

    release(json(TEST_ME));
    await waitFor(() => expect(within(sheet).getByRole("button", { name: "Add to session" })).toBeEnabled());
    expect(within(sheet).queryByText(REASON)).toBeNull();
    await waitFor(() => expect(within(sheet).getByRole("button", { name: "Add to session" })).toHaveFocus());
    expect(meCalls()).toHaveLength(2);
  });

  it("Explore’s target sheet: a retry that answers signed out shows Sign in to add", async () => {
    handlers["GET /api/auth/me"] = down;
    handlers["GET /api/locations"] = () => json([place]);
    handlers["GET /api/equipment"] = () => json([]);
    handlers["GET /api/targets/M31/visibility"] = () => json(targetVisibility);
    renderDetail("M31");
    const sheet = await screen.findByRole("dialog");
    await within(sheet).findByText(REASON);
    handlers["GET /api/auth/me"] = () => json({ detail: "Sign in to continue." }, 401);
    await userEvent.setup().click(within(sheet).getByRole("button", { name: "Try again" }));
    const link = await within(sheet).findByRole("link", { name: "Sign in to add to session" });
    await waitFor(() => expect(link).toHaveFocus());
    expect(meCalls()).toHaveLength(2);
    expect(urls.filter(owned)).toEqual([]);
  });
});

function renderDetail(targetId: string) {
  const qc = createQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <PrefsProvider initial={DEFAULT_PREFS}>
        <MemoryRouter initialEntries={["/explore"]}>
          <TargetDetail targetId={targetId} onClose={() => {}} />
        </MemoryRouter>
      </PrefsProvider>
    </QueryClientProvider>,
  );
  return qc;
}

const starFixture = {
  star: { id: "var:ss-cyg", name: "SS Cygni", primary_designation: "SS Cyg", category: "variable", kind: "variable", constellation: "Cygnus", ra_deg: 1, dec_deg: 2 },
  vsx: { max_mag: 7.7, min_mag: 12.4, band: "V", raw_range: [] },
  type_label: "Dwarf nova",
  period_note: null,
  source_url: "https://vsx.aavso.org/index.php?view=detail.top&oid=1",
  retrieved: "2026-11-02",
  attribution: [],
  nights: [],
  missions: [],
  seestar_fit: null,
};
const starVisibility = {
  computed_at_utc: "2026-11-02T20:00:00Z",
  star: {},
  visibility: {
    can_observe: true,
    status_text: "Observable",
    min_altitude_deg: 30,
    best_window: { start_utc: "2026-11-03T00:30:00Z", end_utc: "2026-11-03T05:30:00Z", minutes: 300 },
  },
  night: { timezone: "America/New_York" },
};
const targetVisibility = {
  computed_at_utc: "2026-11-03T20:00:00Z",
  target: {
    id: "M31",
    name: "Andromeda Galaxy",
    primary_designation: "M31",
    kind: "Galaxy",
    constellation: "Andromeda",
    aliases: [],
    ra_deg: 10.68,
    dec_deg: 41.27,
    angular_major_arcmin: 190,
    angular_minor_arcmin: 60,
    magnitude: 3.4,
    magnitude_band: "V",
    source_url: "https://github.com/mattiaverga/OpenNGC",
    source_id: "NGC0224",
    emission_line_dominant: false,
  },
  visibility: {
    status: "observable",
    status_text: "Observable",
    status_detail: "",
    can_observe: true,
    min_altitude_deg: 30,
    best_window: { start_utc: "2026-11-04T00:00:00Z", end_utc: "2026-11-04T04:00:00Z", minutes: 240 },
    max_alt_dark_deg: 80,
    max_alt_dark_utc: "2026-11-04T02:00:00Z",
    culmination_alt_deg: 80,
    culmination_utc: "2026-11-04T02:00:00Z",
    circumpolar: false,
    never_rises: false,
    rise_utc: "2026-11-03T18:00:00Z",
    set_utc: "2026-11-04T10:00:00Z",
    moon_separation_deg: { basis: "calculated", min: 90, moon_up_fraction: 0 },
    series: { t_ms: [], alt_deg: [] },
  },
  score: { total: 70, max_total: 100, components: [], cautions: [], why: [], forecast_window: null },
  night: { timezone: "America/New_York", dark_intervals: [], events: [], notes: [], has_darkness: true },
  weather_status: "ok",
};

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
