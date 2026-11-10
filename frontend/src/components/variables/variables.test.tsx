import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import type { TargetPage } from "../../api/astrolog";
import { ConfirmProvider } from "../ui/ConfirmDialog";

const mocks = vi.hoisted(() => ({
  observer: { lat: 40, lon: -75, elevation_m: 0, date: "2026-11-02", timezone: "America/New_York" } as unknown,
  equipment: { id: "seestar-s30", name: "Seestar S30" } as unknown,
  addTarget: vi.fn(),
}));

vi.mock("../../api/hooks", async (orig) => {
  const mod = await orig<typeof import("../../api/hooks")>();
  return { ...mod, useObserver: () => mocks.observer, useCurrentEquipment: () => mocks.equipment };
});
vi.mock("../layout/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../../state/prefs", () => ({
  usePrefs: () => ({ prefs: { minAltitudeDeg: 30, darkness: "astronomical", nightDate: "2026-11-02", activeSessionId: null }, update: vi.fn() }),
}));
vi.mock("../../state/activeSession", () => ({
  useActiveSession: () => ({ inSession: () => false, isAdding: false, error: null, addTarget: mocks.addTarget }),
}));

import { Row as ExploreRow } from "../../pages/ExplorePage";
import type { Recommendation } from "../../api/types";
import { StarPage } from "../../pages/StarPage";
import { TargetLogPage } from "../../pages/TargetLogPage";
import { VariableHunterPage } from "../../pages/VariableHunterPage";

const NAMES = ["R Leonis", "SS Cygni", "T Coronae Borealis", "U Geminorum"];
const SLUGS = ["r-leo", "ss-cyg", "t-crb", "u-gem"];
const vsx = { max_mag: 7.7, min_mag: 12.4, band: "V", raw_range: ["7.7 V", "12.4 V"] };
const listBody = {
  stars: NAMES.map((name, i) => ({
    id: `var:${SLUGS[i]}`, slug: SLUGS[i], name, primary_designation: name, category: "variable", kind: "variable",
    constellation: "Cygnus", ra_deg: 1, dec_deg: 2, type_label: "Dwarf nova", vsx, nights_count: i,
  })),
};
const mission = (key: string, title: string) => ({ key, title, description: `${title} desc`, progress: 1, goal: null, unit: "week streak" });
function starBody(over: Record<string, unknown> = {}) {
  return {
    star: { id: "var:ss-cyg", name: "SS Cygni", primary_designation: "SS Cyg", category: "variable", kind: "variable", constellation: "Cygnus", ra_deg: 1, dec_deg: 2 },
    vsx, type_label: "Dwarf nova", period_note: null,
    source_url: "https://vsx.aavso.org/index.php?view=detail.top&oid=1", retrieved: "2026-11-02",
    attribution: ["Catalog data: International Variable Star Index (VSX), operated at AAVSO, Cambridge, Massachusetts, USA."],
    nights: ["2026-10-01"],
    missions: [mission("weekly", "Weekly watch")],
    seestar_fit: null,
    ...over,
  };
}
const visBody = (canObserve = true) => ({
  computed_at_utc: "2026-11-02T20:00:00Z",
  star: {},
  visibility: {
    can_observe: canObserve, status_text: canObserve ? "Observable" : "Below the horizon all night", min_altitude_deg: 30,
    best_window: canObserve ? { start_utc: "2026-11-03T00:30:00Z", end_utc: "2026-11-03T05:30:00Z", minutes: 300 } : null,
  },
  night: { timezone: "America/New_York" },
});

let routes: Record<string, () => unknown>;
let calls: { url: string; init?: RequestInit }[];

beforeEach(() => {
  calls = [];
  routes = {};
  mocks.addTarget.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const path = url.split("?")[0];
    const key = Object.keys(routes).find((k) => (init?.method ?? "GET") + " " + path === k);
    if (!key) return new Response(JSON.stringify({ detail: `no mock for ${path}` }), { status: 500 });
    return new Response(JSON.stringify(routes[key]()), { status: 200 });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(path: string, ui: React.ReactNode, routePath: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={routePath} element={ui} />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

describe("Variable Hunter list", () => {
  it("renders one card per star with range and nights, sending the observer timezone", async () => {
    routes["GET /api/variables"] = () => listBody;
    routes["GET /api/variables/ss-cyg/visibility"] = () => visBody();
    routes["GET /api/variables/r-leo/visibility"] = () => visBody(false);
    routes["GET /api/variables/t-crb/visibility"] = () => visBody();
    routes["GET /api/variables/u-gem/visibility"] = () => visBody();
    renderAt("/variables", <VariableHunterPage />, "/variables");
    const list = await screen.findByRole("list", { name: "Variable stars" });
    expect(within(list).getAllByRole("link")).toHaveLength(4);
    for (const n of NAMES) expect(within(list).getByText(n)).toBeInTheDocument();
    expect(within(list).getAllByText(/range 7.7–12.4 V \(VSX\)/)).toHaveLength(4);
    expect(await within(list).findByText(/Below the horizon all night/)).toBeInTheDocument();
    expect((await within(list).findAllByText(/Tonight: above 30° from/)).length).toBe(3);
    expect(within(list).getByText("Your nights: 3")).toBeInTheDocument();
    expect(calls.find((c) => c.url.startsWith("/api/variables?"))?.url).toContain("timezone=America%2FNew_York");
  });
});

describe("Variable Hunter list: zero nights", () => {
  it("omits the nights line when the count is zero", async () => {
    routes["GET /api/variables"] = () => listBody;
    for (const sl of SLUGS) routes[`GET /api/variables/${sl}/visibility`] = () => visBody();
    renderAt("/variables", <VariableHunterPage />, "/variables");
    const list = await screen.findByRole("list", { name: "Variable stars" });
    expect(within(list).queryByText("Your nights: 0")).toBeNull();
    expect(within(list).getAllByText(/Your nights: \d/)).toHaveLength(3);
  });
});

describe("Explore rows", () => {
  const rec = (name: string, designation: string, status: string): Recommendation =>
    ({
      target: { id: "t1", name, primary_designation: designation, kind: "galaxy", constellation: "Andromeda", angular_major_arcmin: 10, angular_minor_arcmin: 5 },
      visibility: {
        status, status_text: status === "observable" ? "Observable during darkness" : "Below the minimum altitude", status_detail: "detail",
        best_window: status === "observable" ? { start_utc: "2026-11-03T00:30:00Z", end_utc: "2026-11-03T05:30:00Z", minutes: 300 } : null,
        max_alt_dark_deg: 60,
      },
      score: { total: null, max_total: 100 },
      sparkline_alt_deg: [],
    }) as unknown as Recommendation;
  const show = (r: Recommendation) =>
    renderAt("/", <ul><ExploreRow rec={r} tz="America/New_York" minAlt={30} onOpen={() => {}} /></ul>, "/");

  it("hides the designation when it equals the name and does not repeat 'Observable' on observable rows", () => {
    const { container } = show(rec("M31", "M31", "observable"));
    expect(container.textContent).not.toMatch(/M31 · M31/);
    expect(screen.queryByText("Observable during darkness")).toBeNull();
    expect(container.textContent).toMatch(/peak/);
  });

  it("keeps the designation when it differs and shows the status as a plain sentence on non-observable rows", () => {
    const { container } = show(rec("Andromeda Galaxy", "M31", "below_threshold"));
    expect(container.textContent).toContain("M31 · galaxy");
    expect(screen.getByText("Below the minimum altitude. detail")).toBeInTheDocument();
    expect(container.querySelector(".badge")).toBeNull();
  });
});

describe("Variable Hunter list: edge states", () => {
  it("shows plain no-location text with no nested anchors", async () => {
    mocks.observer = null;
    routes["GET /api/variables"] = () => listBody;
    try {
      const { container } = renderAt("/variables", <VariableHunterPage />, "/variables");
      await screen.findByRole("list", { name: "Variable stars" });
      expect(screen.getAllByText("Set a location in Settings to see tonight's window")).toHaveLength(4);
      expect(container.querySelectorAll("a a")).toHaveLength(0);
    } finally {
      mocks.observer = { lat: 40, lon: -75, elevation_m: 0, date: "2026-11-02", timezone: "America/New_York" };
    }
  });

  it("shows the VSX catalog attribution and no AAVSO observations line", async () => {
    routes["GET /api/variables"] = () => listBody;
    routes["GET /api/variables/ss-cyg/visibility"] = () => visBody();
    routes["GET /api/variables/r-leo/visibility"] = () => visBody();
    routes["GET /api/variables/t-crb/visibility"] = () => visBody();
    routes["GET /api/variables/u-gem/visibility"] = () => visBody();
    renderAt("/variables", <VariableHunterPage />, "/variables");
    expect(await screen.findByText(/Catalog data: International Variable Star Index \(VSX\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Observations from the AAVSO International Database/)).toBeNull();
  });
});

describe("Star page", () => {
  beforeEach(() => {
    routes["GET /api/variables/ss-cyg"] = () => starBody();
    routes["GET /api/variables/ss-cyg/visibility"] = () => visBody();
  });
  const open = () => renderAt("/variables/ss-cyg", <StarPage />, "/variables/:slug");

  it("explains there is no light curve and links to the star on AAVSO VSX", async () => {
    const { container } = open();
    expect(await screen.findByText(/AstroPlanner doesn.t download AAVSO observations, so it draws no light curve/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /View SS Cyg on AAVSO VSX/ });
    expect(link).toHaveAttribute("href", "https://vsx.aavso.org/index.php?view=detail.top&oid=1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(container.querySelector("svg.recharts-surface, canvas, [data-testid=light-curve]")).toBeNull();
    expect(screen.queryByText("Planned for a later phase")).toBeNull();
    expect(screen.getByText(/International Variable Star Index/)).toBeInTheDocument();
  });

  it("lays the facts out as a plain definition list and the explainer at reading width, unboxed", async () => {
    routes["GET /api/variables/ss-cyg"] = () =>
      starBody({ seestar_fit: { estimate_range: [7, 12.5], label: "estimate, not yet measured", text: "Estimated range." } });
    open();
    const dl = (await screen.findByText("Light curve")).closest("dl") as HTMLElement;
    expect(dl).not.toBeNull();
    expect(dl.className).not.toMatch(/\bpanel\b/);
    expect(dl.className).toContain("sm:grid-cols-[10rem_1fr]");
    const terms = Array.from(dl.querySelectorAll("dt")).map((t) => t.textContent ?? "");
    expect(terms).toContain("Tonight");
    expect(terms.some((t) => t.startsWith("Seestar fit"))).toBe(true);
    expect(terms).toContain("Light curve");
    const heading = screen.getByText("How to read a variable star");
    expect(heading.closest(".panel")).toBeNull();
    expect(heading.closest("section")?.querySelector("ul")?.className).toContain("max-w-[68ch]");
  });

  it("shows the star's missions and requests no AAVSO observations", async () => {
    open();
    expect(await screen.findByRole("article", { name: "Mission: Weekly watch" })).toBeInTheDocument();
    expect(calls.some((c) => /\/api\/variables\/(alerts|[^/?]+\/curve)/.test(c.url))).toBe(false);
  });

  it("renders the Seestar estimate label when present", async () => {
    routes["GET /api/variables/ss-cyg"] = () =>
      starBody({ seestar_fit: { estimate_range: [7, 12.5], label: "estimate, not yet measured", text: "Estimated S30 working range is about V 7 to 12.5 (estimate, not yet measured)." } });
    open();
    expect(await screen.findByText(/estimate, not yet measured/)).toBeInTheDocument();
  });

  it("adds the star to the plan with its best window", async () => {
    open();
    const btn = await screen.findByRole("button", { name: "Add to tonight's plan" });
    await waitFor(() => expect(btn).toBeEnabled());
    await userEvent.click(btn);
    expect(mocks.addTarget).toHaveBeenCalledWith("var:ss-cyg", expect.objectContaining({ start_utc: "2026-11-03T00:30:00Z" }));
  });

  it("disables the add button with a reason when the star is not observable", async () => {
    routes["GET /api/variables/ss-cyg/visibility"] = () => visBody(false);
    open();
    const btn = await screen.findByRole("button", { name: "Add to tonight's plan" });
    await waitFor(() => expect(btn).toBeDisabled());
    expect(screen.getAllByText("Below the horizon all night").length).toBeGreaterThan(0);
  });

  it("tells the user to set a location when there is none", async () => {
    mocks.observer = null;
    try {
      open();
      const btn = await screen.findByRole("button", { name: "Add to tonight's plan" });
      expect(btn).toBeDisabled();
      expect(screen.getAllByText(/Set a location in/).length).toBeGreaterThan(0);
    } finally {
      mocks.observer = { lat: 40, lon: -75, elevation_m: 0, date: "2026-11-02", timezone: "America/New_York" };
    }
  });
});

describe("AstroLog link", () => {
  const page = (kind: "custom" | "catalog"): TargetPage =>
    ({
      target: { id: "lt1", display_name: "My variable", kind, catalog_target_id: null, custom_name: "My variable", category: null },
      final_image: null, stack: null, stacks: [], headline: { seconds: null, label: "captured", provenance: "", basis: "captured" },
      captured_s: null, frames_total: 0, percent_used: null, frames_in_stack_range: null, facts: [], nights: [], stack_suggestion_id: null,
    }) as unknown as TargetPage;

  function setup(kind: "custom" | "catalog") {
    routes["GET /api/astrolog/targets/lt1"] = () => page(kind);
    routes["GET /api/variables"] = () => listBody;
    routes["POST /api/astrolog/targets/lt1/link-variable"] = () => ({ ...page("catalog"), target: { ...page("catalog").target, id: "lt2" } });
    routes["GET /api/astrolog/targets/lt2"] = () => ({ ...page("catalog"), target: { ...page("catalog").target, id: "lt2", display_name: "SS Cygni" } });
    renderAt("/astrolog/targets/lt1", <TargetLogPage />, "/astrolog/targets/:targetId");
  }

  it("offers 'This is SS Cygni' only for custom targets and posts the link after confirming", async () => {
    setup("custom");
    await screen.findByRole("heading", { name: "My variable" });
    await userEvent.selectOptions(await screen.findByLabelText("Star"), "var:ss-cyg");
    await userEvent.click(screen.getByRole("button", { name: "This is SS Cygni" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "This is SS Cygni" }));
    await waitFor(() => {
      const post = calls.find((c) => c.init?.method === "POST");
      expect(post?.url).toBe("/api/astrolog/targets/lt1/link-variable");
      expect(JSON.parse(post!.init!.body as string)).toEqual({ star_id: "var:ss-cyg" });
    });
  });

  it("does not offer it for catalog targets", async () => {
    setup("catalog");
    await screen.findByRole("heading", { name: "My variable" });
    expect(screen.queryByLabelText("Star")).toBeNull();
    expect(screen.queryByRole("button", { name: /^This is/ })).toBeNull();
  });
});

describe("routing", () => {
  it("redirects /research to /variables", async () => {
    routes["GET /api/variables"] = () => ({ ...listBody, stars: [] });
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <ConfirmProvider>
          <MemoryRouter initialEntries={["/research"]}>
            <App />
          </MemoryRouter>
        </ConfirmProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Variable Hunter" })).toBeInTheDocument();
  });
});

describe("Star page: Seestar note", () => {
  it("titles the Seestar note without nested parentheses", async () => {
    mocks.equipment = { id: "seestar-s30", name: "Seestar S30 (original)" };
    try {
      routes["GET /api/variables/ss-cyg"] = () => starBody({ seestar_fit: { estimate_range: [7, 12.5], label: "estimate, not yet measured", text: "x" } });
      routes["GET /api/variables/ss-cyg/visibility"] = () => visBody();
      renderAt("/variables/ss-cyg", <StarPage />, "/variables/:slug");
      expect(await screen.findByText("Seestar fit · Seestar S30 (original)")).toBeInTheDocument();
    } finally {
      mocks.equipment = { id: "seestar-s30", name: "Seestar S30" };
    }
  });
});

describe("AstroLog link: confirm wording", () => {
  it("says the target becomes the star, merged with any existing one", async () => {
    routes["GET /api/astrolog/targets/lt1"] = () =>
      ({
        target: { id: "lt1", display_name: "My variable", kind: "custom", catalog_target_id: null, custom_name: "My variable", category: null },
        final_image: null, stack: null, stacks: [], headline: { seconds: null, label: "captured", provenance: "", basis: "captured" },
        captured_s: null, frames_total: 0, percent_used: null, frames_in_stack_range: null, facts: [], nights: [], stack_suggestion_id: null,
      }) as unknown;
    routes["GET /api/variables"] = () => listBody;
    renderAt("/astrolog/targets/lt1", <TargetLogPage />, "/astrolog/targets/:targetId");
    await userEvent.selectOptions(await screen.findByLabelText("Star"), "var:ss-cyg");
    await userEvent.click(screen.getByRole("button", { name: "This is SS Cygni" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent('"My variable" will become SS Cygni (merged with any existing SS Cygni target)');
    expect(dialog).not.toHaveTextContent("will be merged into");
  });
});
