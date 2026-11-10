import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { History } from "../api/astrolog";
import { TargetCard } from "./targets/TargetCard";
import { SkyThumb } from "./targets/SkyThumb";
import { framingNote } from "./targets/FramingDiagram";
import type { Recommendation, Target } from "../api/types";
import { HistoryBadge } from "./astrolog/HistoryBadge";
import type { SessionTarget, TonightScore } from "../api/types";
import { pickSessionForNight, sessionTitleForNight } from "../state/activeSession";
import { moveId, SessionTargetList } from "./session/SessionTargetList";
import { ScoreHero } from "./tonight/ScoreHero";
import { formatCalendarDate, nightPageTitle } from "../lib/time";
import { PageHeader } from "./ui/PageHeader";
import { BasisBadge } from "./ui/States";
import { HeaderControls } from "./layout/HeaderControls";
import { useSheetDrag } from "./ui/useSheetDrag";
import { Overlay, SheetTop } from "./ui/Overlay";
import { PrefsProvider } from "../state/prefs";

const base: Omit<TonightScore, "status" | "total" | "components"> = {
  kind: "heuristic",
  max_total: 100,
  darkness: "astronomical",
  method: "method text",
  disclaimer: "Planning estimate",
  window: { start_utc: "2026-11-03T00:35:00Z", end_utc: "2026-11-03T02:35:00Z", minutes: 120 },
  summary: "",
};

describe("ScoreHero", () => {
  it("renders no total when the forecast is unavailable", () => {
    const score: TonightScore = {
      ...base,
      status: "no_weather",
      total: null,
      partial_total: 21.8,
      partial_max: 30,
      components: [
        { key: "cloud", label: "Cloud cover", points: null, max: 45, basis: "forecast", detail: "Forecast unavailable" },
        { key: "precipitation", label: "Rain risk", points: null, max: 25, basis: "forecast", detail: "Forecast unavailable" },
        { key: "moon", label: "Moonlight", points: 11.8, max: 20, basis: "calculated", detail: "Moon up" },
        { key: "darkness", label: "Darkness available", points: 10, max: 10, basis: "calculated", detail: "10 h" },
      ],
    };
    render(<ScoreHero score={score} tz="America/New_York" />);
    expect(screen.queryByTestId("score-total")).toBeNull();
    expect(screen.getByTestId("score-no-total")).toHaveTextContent("No score");
    expect(screen.getAllByText("not scored")).toHaveLength(2);
    expect(screen.getByText("21.8")).toBeInTheDocument();
  });

  it("renders the total and the window in the observer's zone", () => {
    const score: TonightScore = {
      ...base,
      status: "ok",
      total: 97.8,
      components: [
        { key: "cloud", label: "Cloud cover", points: 43, max: 45, basis: "forecast", detail: "" },
        { key: "precipitation", label: "Rain risk", points: 24.8, max: 25, basis: "forecast", detail: "" },
        { key: "moon", label: "Moonlight", points: 20, max: 20, basis: "calculated", detail: "" },
        { key: "darkness", label: "Darkness available", points: 10, max: 10, basis: "calculated", detail: "" },
      ],
    };
    render(<ScoreHero score={score} tz="America/New_York" />);
    expect(screen.getByTestId("score-total")).toHaveTextContent("98");
    expect(screen.getByText(/Components sum to 97.8/)).toBeInTheDocument();
    expect(screen.getByText(/19:35–21:35 EST/)).toBeInTheDocument();
    expect(screen.getByText(/for the best 2 h,/)).toBeInTheDocument();
    expect(screen.getByText("Heuristic")).toBeVisible();
  });

  it("names the real window length when the best window is shorter than two hours", () => {
    const score: TonightScore = {
      ...base,
      status: "ok",
      total: 60,
      window: { start_utc: "2026-11-03T00:35:00Z", end_utc: "2026-11-03T01:50:00Z", minutes: 75 },
      components: [{ key: "cloud", label: "Cloud cover", points: 40, max: 45, basis: "forecast", detail: "" }],
    };
    render(<ScoreHero score={score} tz="America/New_York" />);
    expect(screen.getByText(/for the best 1 h 15 min, 19:35–20:50 EST/)).toBeInTheDocument();
    expect(screen.queryByText(/best 2 hours/)).toBeNull();
  });

  it("keeps the breakdown inside a 'Why this score' disclosure and shows the headline", () => {
    const score: TonightScore = {
      ...base,
      status: "ok",
      total: 80,
      components: [{ key: "cloud", label: "Cloud cover", points: 40, max: 45, basis: "forecast", detail: "" }],
    };
    const { container } = render(<ScoreHero score={score} tz="America/New_York" headline={{ title: "Clear all night", detail: "9 h of 9 h" }} />);
    const details = container.querySelector("details");
    expect(details?.querySelector("summary")?.textContent).toBe("Why this score");
    // The summary presses (scale 0.97) from its own box: as wide as its text, so it does not shrink toward the panel centre.
    expect(details?.querySelector("summary")?.className).toMatch(/(^| )w-fit( |$)/);
    expect(details?.querySelector('ul[aria-label="Score components"]')).not.toBeNull();
    expect(screen.getByText("Clear all night")).toBeVisible();
  });
});

describe("nightPageTitle", () => {
  it("says Tonight for the automatic night and the date otherwise", () => {
    expect(nightPageTitle("2026-11-09", true)).toBe("Tonight");
    expect(nightPageTitle("2026-11-23", false)).toBe(formatCalendarDate("2026-11-23", true));
    expect(nightPageTitle("2026-11-23", false)).not.toBe("Tonight");
  });
});

const targets: SessionTarget[] = ["m31", "m42", "m45"].map((id, i) => ({
  id: `st-${id}`,
  target_id: id,
  sort_order: i,
  planned_start_utc: null,
  planned_end_utc: null,
  notes: null,
  target: { id, primary_designation: id.toUpperCase(), name: `Target ${id}`, category: "galaxy", kind: "Galaxy", constellation: "And", ra_deg: 0, dec_deg: 0 },
}));

describe("SessionTargetList", () => {
  it("disables impossible moves and reorders with buttons", async () => {
    const onReorder = vi.fn();
    const onRemove = vi.fn();
    render(<SessionTargetList targets={targets} tz="UTC" onReorder={onReorder} onRemove={onRemove} />);
    expect(screen.getByRole("button", { name: "Move Target m31 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Target m45 down" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Move Target m31 down" }));
    expect(onReorder).toHaveBeenCalledWith(["st-m42", "st-m31", "st-m45"]);
    await userEvent.click(screen.getByRole("button", { name: "Remove Target m42" }));
    expect(onRemove).toHaveBeenCalledWith("st-m42");
  });

  it("moveId swaps neighbours and ignores out-of-range moves", () => {
    expect(moveId(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveId(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
});

describe("active session selection", () => {
  const mk = (id: string, night: string, status: "planned" | "cancelled" = "planned") =>
    ({ id, local_night_date: night, status, targets: [] }) as never;
  it("prefers the active session only when it is for the selected night", () => {
    const list = [mk("a", "2026-11-01"), mk("b", "2026-11-02")];
    expect(pickSessionForNight(list, "a", "2026-11-02")).toMatchObject({ id: "b" });
    expect(pickSessionForNight(list, "a", "2026-11-01")).toMatchObject({ id: "a" });
    expect(pickSessionForNight([mk("c", "2026-11-02", "cancelled")], "c", "2026-11-02")).toBeNull();
  });
  it("names new sessions after the night", () => {
    expect(sessionTitleForNight("2026-11-02")).toBe("Night of 2 Nov 2026");
  });
});

const mockHistory = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("../api/astrolog", async (orig) => ({
  ...(await orig<typeof import("../api/astrolog")>()),
  useAstroLogHistory: () => ({ data: mockHistory.data }),
}));

function renderBadge(history: History | undefined, id = "ngc7635") {
  mockHistory.data = history;
  return render(
    <MemoryRouter>
      <HistoryBadge catalogId={id} />
    </MemoryRouter>,
  );
}

describe("HistoryBadge", () => {
  it("shows stacked time and links to the target page", () => {
    renderBadge({ ngc7635: { seconds: 6540, label: "stack", library_target_id: "lt1" } });
    const el = screen.getByText("You have 1 h 49 m stacked");
    expect(el.closest("a")).toHaveAttribute("href", "/astrolog/targets/lt1");
  });
  it("says captured when there is no stack", () => {
    renderBadge({ ngc7635: { seconds: 6540, label: "captured", library_target_id: "lt1" } });
    expect(screen.getByText("You have 1 h 49 m captured")).toBeInTheDocument();
  });
  it("renders nothing for targets without history", () => {
    const { container } = renderBadge({ m31: { seconds: 60, label: "stack", library_target_id: "x" } });
    expect(container).toBeEmptyDOMElement();
    cleanup();
    renderBadge(undefined);
    expect(screen.queryByText(/You have/)).toBeNull();
  });
});

describe("TargetCard history badge", () => {
  const rec = {
    target: { id: "ngc7635", name: "Bubble Nebula", primary_designation: "NGC 7635", kind: "nebula", constellation: "Cas" },
    visibility: { best_window: null, status_text: "Not tonight", max_alt_dark_deg: null, can_observe: false },
    score: { total: null, max_total: null, why: [], cautions: [] },
    sparkline_alt_deg: [],
  } as unknown as Recommendation;
  const card = () =>
    render(
      <MemoryRouter>
        <TargetCard rec={rec} tz="UTC" minAlt={30} onOpen={() => {}} onAdd={() => {}} inSession={false} adding={false} />
      </MemoryRouter>,
    );

  it("shows the badge linking to the library target when history exists", () => {
    mockHistory.data = { ngc7635: { seconds: 6540, label: "stack", library_target_id: "lt1" } };
    card();
    expect(screen.getByText("You have 1 h 49 m stacked").closest("a")).toHaveAttribute("href", "/astrolog/targets/lt1");
  });
  it("shows no badge without history", () => {
    mockHistory.data = {};
    card();
    expect(screen.queryByText(/You have/)).toBeNull();
  });
});

describe("PageHeader", () => {
  it("renders one h1, a back link with an icon, subtitle and actions", () => {
    const { container } = render(
      <MemoryRouter>
        <PageHeader title="Nights" subtitle="Every night" back={{ to: "/astrolog", label: "Library" }} actions={<button type="button">Act</button>} />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Nights" })).toBeTruthy();
    const back = screen.getByRole("link", { name: "Library" });
    expect(back.getAttribute("href")).toBe("/astrolog");
    expect(back.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("Every night")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Act" })).toBeTruthy();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("omits the back link when none is given", () => {
    render(
      <MemoryRouter>
        <PageHeader title="Settings" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("BasisBadge", () => {
  it("styles forecast and heuristic differently", () => {
    const { container: a } = render(<BasisBadge basis="forecast" />);
    const { container: b } = render(<BasisBadge basis="heuristic" />);
    expect(a.firstElementChild?.className).not.toBe(b.firstElementChild?.className);
    expect(b.firstElementChild?.className).toContain("border-dashed");
  });
});

describe("framingNote", () => {
  it("applies the four thresholds on major / field width", () => {
    expect(framingNote(130, 2)).toEqual({ text: "Larger than the field", warn: true });
    expect(framingNote(120, 2)).toEqual({ text: "Fills the field", warn: false }); // ratio 1.0 is not above 1
    expect(framingNote(90, 2)).toEqual({ text: "Fills the field", warn: false }); // 0.75
    expect(framingNote(60, 2)).toEqual({ text: "Fits the field", warn: false });
    expect(framingNote(18, 2)).toEqual({ text: "Small in the field", warn: false }); // 0.15
  });
  it("returns null without both inputs", () => {
    expect(framingNote(null, 2)).toBeNull();
    expect(framingNote(30, null)).toBeNull();
  });
});

describe("TargetCard layout", () => {
  const mk = (over: Record<string, unknown> = {}, name = "Bubble Nebula", des = "NGC 7635") =>
    ({
      target: { id: "ngc7635", name, primary_designation: des, kind: "nebula", category: "nebula", constellation: "Cas", angular_major_arcmin: 15, angular_minor_arcmin: 8 },
      visibility: { best_window: { start_utc: "2026-11-03T00:35:00Z", end_utc: "2026-11-03T02:35:00Z" }, status_text: "", max_alt_dark_deg: 70, can_observe: true, observable_minutes: 300 },
      score: { total: 91, max_total: 100, why: [], cautions: ["Moon near", "Second caution"], forecast_window: { minutes: 240 } },
      sparkline_alt_deg: [],
      ...over,
    }) as unknown as Recommendation;
  const show = (rec: Recommendation, onOpen = vi.fn(), onAdd = vi.fn()) => {
    mockHistory.data = {};
    render(
      <MemoryRouter>
        <TargetCard rec={rec} tz="UTC" minAlt={30} fovDeg={2.46} onOpen={onOpen} onAdd={onAdd} inSession={false} adding={false} />
      </MemoryRouter>,
    );
    return { onOpen, onAdd };
  };
  it("shows name, score, window, and clear time against time up", () => {
    show(mk());
    expect(screen.getByRole("button", { name: "Bubble Nebula" })).toBeTruthy();
    expect(screen.getByText("91")).toBeTruthy();
    expect(screen.getByText(/00:35/)).toBeTruthy();
    expect(screen.getByText("4 h clear")).toBeTruthy();
    expect(screen.getByText("of 5 h up")).toBeTruthy();
    expect(screen.getByText("Moon near")).toBeTruthy();
    expect(screen.queryByText("Second caution")).toBeNull();
  });
  it("omits 'of up' when the clear run is within a minute of the time up", () => {
    show(mk({ visibility: { best_window: null, status_text: "", max_alt_dark_deg: 70, can_observe: true, observable_minutes: 240.5 } }));
    expect(screen.queryByText(/of .* up/)).toBeNull();
  });
  it("hides the designation when it equals the name", () => {
    show(mk({}, "NGC 7635", "NGC 7635"));
    expect(screen.getAllByText(/NGC 7635/)).toHaveLength(1);
  });
  it("scales the card only from the name's press target, not the add button or badge", () => {
    // jsdom does not evaluate :active or :has, so the markup contract is checked instead: the article carries
    // no .press, and the only .card-open element is the name button.
    show(mk());
    const article = screen.getByRole("article");
    expect(article.className).not.toMatch(/\bpress\b/);
    expect(article.className).toContain("has-[.card-open:active]:scale-[0.97]");
    const open = article.querySelectorAll(".card-open");
    expect(open).toHaveLength(1);
    expect(open[0]).toBe(screen.getByRole("button", { name: "Bubble Nebula" }));
    expect(screen.getByRole("button", { name: "Add Bubble Nebula to session" }).closest(".card-open")).toBeNull();
  });
  it("shows a quiet tinted Add button: same name, visible label from sm up, not the primary fill", () => {
    show(mk());
    const add = screen.getByRole("button", { name: "Add Bubble Nebula to session" });
    expect(add.className).toContain("btn-tinted");
    expect(add.className).not.toContain("btn-primary");
    expect(add.className).not.toContain("size-11");
    expect(add.className).toContain("min-h-9");
    expect(add.className).toContain("min-w-11");
    const label = within(add).getByText("Add");
    expect(label.className).toContain("max-sm:sr-only");
  });
  it("keeps the in-session button as it was", () => {
    mockHistory.data = {};
    render(
      <MemoryRouter>
        <TargetCard rec={mk()} tz="UTC" minAlt={30} fovDeg={2.46} onOpen={() => {}} onAdd={() => {}} inSession adding={false} />
      </MemoryRouter>,
    );
    const done = screen.getByRole("button", { name: "Bubble Nebula is in your session" });
    expect(done.className).toContain("btn-ghost");
    expect(done.className).toContain("text-ice");
    expect(done.className).toContain("size-11");
    expect(done.className).not.toContain("btn-tinted");
    expect(done).toBeDisabled();
  });
  it("keeps the score after a 40-character name, in the same row", () => {
    const name = "Extraordinarily Long Nebula Name Number1";
    expect(name).toHaveLength(40);
    show(mk({}, name));
    const heading = screen.getByRole("heading", { name });
    const score = screen.getByText("91").closest("div")!;
    expect(score.parentElement).toBe(heading.parentElement);
    expect(heading.compareDocumentPosition(score) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(score.className).toContain("flex-none");
  });
  it("opens details from the name; the add button does not", async () => {
    const { onOpen, onAdd } = show(mk());
    await userEvent.click(screen.getByRole("button", { name: "Add Bubble Nebula to session" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Bubble Nebula" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

const mockSky = vi.hoisted(() => ({ load: vi.fn((_url: string, _signal?: AbortSignal): Promise<string | null> => Promise.resolve("blob:sky")) }));
vi.mock("../lib/skyImageQueue", () => ({ loadSkyImageUrl: mockSky.load }));

describe("SkyThumb", () => {
  const target = { id: "ngc7635", name: "Bubble Nebula", angular_major_arcmin: 15, angular_minor_arcmin: 8, sky_field_arcmin: 40 } as unknown as Target;
  const diagram = (c: HTMLElement) => c.querySelector("svg[viewBox='0 0 112 112']");
  it("shows the diagram until the image loads, then marks the image loaded with the width", async () => {
    const { container } = render(<SkyThumb target={target} fovDeg={2.46} size={112} />);
    expect(diagram(container)).not.toBeNull();
    const img = await screen.findByAltText("Digitized Sky Survey image of Bubble Nebula");
    expect(mockSky.load).toHaveBeenCalledWith("/api/targets/ngc7635/sky-image", expect.any(AbortSignal));
    expect(img.getAttribute("src")).toBe("blob:sky");
    expect(img.hasAttribute("data-loaded")).toBe(false);
    expect(screen.queryByText("0.67°")).toBeNull();
    fireEvent.load(img);
    expect(img.hasAttribute("data-loaded")).toBe(true);
    expect(screen.getByText("0.67°")).toBeTruthy();
    expect(diagram(container)).not.toBeNull();
  });
  it("shows no fit-status text on the thumbnail, only the field width", async () => {
    const big = { ...target, angular_major_arcmin: 300 } as unknown as Target;
    const { container } = render(<SkyThumb target={big} fovDeg={2.46} size={112} />);
    fireEvent.load(await screen.findByAltText(/Digitized Sky Survey/));
    expect(screen.getByText("0.67°")).toBeTruthy();
    expect(screen.queryByText(/Larger than the field/)).toBeNull();
    expect(container.textContent).toBe("0.67°");
  });
  it("shows no fit-status text on the diagram fallback either", async () => {
    const big = { ...target, angular_major_arcmin: 300, sky_field_arcmin: null } as unknown as Target;
    const { container } = render(<SkyThumb target={big} fovDeg={2.46} size={112} />);
    await act(async () => {});
    expect(diagram(container)).not.toBeNull();
    expect(container.textContent).toBe("");
  });
  it("carries the night-vision picture class", async () => {
    render(<SkyThumb target={target} fovDeg={2.46} size={112} />);
    const img = await screen.findByAltText(/Digitized Sky Survey/);
    expect(img.className).toContain("vision-img");
  });
  it("removes the image on error and keeps the diagram", async () => {
    const { container } = render(<SkyThumb target={target} fovDeg={2.46} size={112} />);
    fireEvent.error(await screen.findByAltText(/Digitized Sky Survey/));
    expect(container.querySelector("img")).toBeNull();
    expect(diagram(container)).not.toBeNull();
  });
  it("keeps the diagram when no image is available", async () => {
    mockSky.load.mockResolvedValueOnce(null);
    const { container } = render(<SkyThumb target={target} fovDeg={2.46} size={112} />);
    await waitFor(() => expect(mockSky.load).toHaveBeenCalled());
    await act(async () => {});
    expect(container.querySelector("img")).toBeNull();
    expect(diagram(container)).not.toBeNull();
  });
  it("still shows the image when the field of view is unknown", async () => {
    const { container } = render(<SkyThumb target={target} fovDeg={null} size={112} />);
    expect(await screen.findByAltText(/Digitized Sky Survey/)).toBeInTheDocument();
    expect(diagram(container)).toBeNull();
  });
  it("requests no image when the server has sky images off", async () => {
    mockSky.load.mockClear();
    const { container } = render(<SkyThumb target={{ ...target, sky_field_arcmin: null }} fovDeg={2.46} size={112} />);
    await act(async () => {});
    expect(mockSky.load).not.toHaveBeenCalled();
    expect(container.querySelector("img")).toBeNull();
    expect(diagram(container)).not.toBeNull();
  });
  it("renders nothing when there is neither an image nor a diagram", () => {
    const { container } = render(<SkyThumb target={{ ...target, sky_field_arcmin: undefined }} fovDeg={null} size={112} />);
    expect(container.firstChild).toBeNull();
  });
});

// ---- Phone sheet and header (jsdom has no layout: real widths are checked by the e2e mobile project) ----

const mockHdr = vi.hoisted(() => ({
  location: { id: "l1", label: "Backyard", timezone: "America/New_York" },
  eq: { id: "e1", name: "Seestar S30" },
}));
vi.mock("../api/hooks", async (orig) => ({
  ...(await orig<typeof import("../api/hooks")>()),
  useLocations: () => ({ data: [mockHdr.location], isLoading: false }),
  useEquipmentList: () => ({ data: [mockHdr.eq], isLoading: false }),
  useCurrentLocation: () => ({ location: mockHdr.location }),
  useCurrentEquipment: () => mockHdr.eq,
  useNightDate: () => ({ nightDate: "2026-11-09", isAuto: true }),
}));

function renderHeader() {
  return render(
    <MemoryRouter>
      <PrefsProvider>
        <HeaderControls />
      </PrefsProvider>
    </MemoryRouter>,
  );
}

describe("HeaderControls on a phone", () => {
  it("renders one chip with '{location} · {scope}' and a sheet holding the controls", () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("max-width"), addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      const { container } = renderHeader();
      const chip = screen.getByRole("button", { name: "Backyard · Seestar S30" });
      expect(chip).toHaveAttribute("aria-haspopup", "dialog");
      expect(screen.getByRole("button", { name: "Night vision" })).toBeInTheDocument();
      const sheet = container.querySelector("dialog.overlay")!;
      expect(sheet).not.toBeNull();
      expect(sheet.contains(container.querySelector("#hdr-location"))).toBe(true);
      expect(sheet.contains(container.querySelector("#hdr-equipment"))).toBe(true);
      expect(sheet.contains(container.querySelector("#hdr-night"))).toBe(true);
      // the controls exist once, not inline as well
      expect(container.querySelectorAll("#hdr-location")).toHaveLength(1);
    } finally {
      window.matchMedia = original;
    }
  });

  it("keeps the inline controls on a wide viewport", () => {
    const { container } = renderHeader();
    expect(container.querySelector("dialog")).toBeNull();
    expect(screen.getByLabelText("Observing location")).toBeInTheDocument();
  });
});

describe("SheetTop drag is phone-only", () => {
  const drawer = () =>
    render(
      <Overlay open onClosed={() => {}} variant="drawer" labelledBy="st-title">
        <SheetTop>
          <h2 id="st-title">Details</h2>
        </SheetTop>
      </Overlay>,
    );
  const dragTitle = () => {
    const title = screen.getByText("Details");
    fireEvent.pointerDown(title, { clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(title, { clientY: 400, pointerId: 1 });
    return title;
  };

  it("at desktop width a pointer drag on the title row does not move the panel", () => {
    const { container } = drawer();
    const panel = container.querySelector<HTMLElement>(".overlay-panel")!;
    const title = dragTitle();
    fireEvent.pointerUp(title, { clientY: 400, pointerId: 1 });
    expect(panel.style.transform).toBe("");
    expect(panel.style.transition).toBe("");
  });

  it("at phone width the same drag moves the panel", () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("max-width"), addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      const { container } = drawer();
      const panel = container.querySelector<HTMLElement>(".overlay-panel")!;
      dragTitle();
      expect(panel.style.transform).toBe("translate3d(0, 390px, 0)");
    } finally {
      window.matchMedia = original;
    }
  });
});

describe("useSheetDrag", () => {
  function Harness({ onDismiss, onSettle }: { onDismiss: () => void; onSettle: () => void }) {
    const panel = useRef<HTMLDivElement>(null);
    const scrim = useRef<HTMLDivElement>(null);
    const drag = useSheetDrag(panel, scrim, onDismiss, { onSettle });
    return (
      <div>
        <div ref={scrim} data-testid="scrim" />
        <div ref={panel} data-testid="panel">
          <div data-testid="region" {...drag}>
            <button type="button">Close</button>
            <span data-testid="handle">handle</span>
          </div>
        </div>
      </div>
    );
  }
  const setup = () => {
    const onDismiss = vi.fn();
    const onSettle = vi.fn();
    render(<Harness onDismiss={onDismiss} onSettle={onSettle} />);
    return { onDismiss, onSettle, panel: screen.getByTestId("panel"), scrim: screen.getByTestId("scrim") };
  };

  it("starts no drag when the press lands on a button in the region", () => {
    const { panel, onDismiss } = setup();
    const btn = screen.getByRole("button", { name: "Close" });
    fireEvent.pointerDown(btn, { clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(btn, { clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(btn, { clientY: 300, pointerId: 1 });
    expect(panel.style.transition).toBe("");
    expect(panel.style.transform).toBe("");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("writes transform and scrim opacity directly while dragging, then clears them", () => {
    const { panel, scrim, onDismiss, onSettle } = setup();
    const handle = screen.getByTestId("handle");
    fireEvent.pointerDown(handle, { clientY: 10, pointerId: 1 });
    expect(panel.style.transition).toBe("none");
    fireEvent.pointerMove(handle, { clientY: 60, pointerId: 1 });
    expect(panel.style.transform).toBe("translate3d(0, 50px, 0)");
    expect(scrim.style.opacity).not.toBe("");
    // a cancelled gesture never dismisses (no timing dependence): the sheet settles
    fireEvent.pointerCancel(handle, { clientY: 60, pointerId: 1 });
    expect(panel.style.transform).toBe("");
    expect(panel.style.transition).toBe("");
    expect(scrim.style.opacity).toBe("");
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("catching a closing sheet writes its live transform and scrim opacity back instead of jumping", () => {
    class FakeMatrix {
      m42: number;
      constructor(t: string) {
        this.m42 = Number(t.split(",")[5]?.replace(")", ""));
      }
    }
    vi.stubGlobal("DOMMatrixReadOnly", FakeMatrix);
    const { panel, scrim } = setup();
    const real = window.getComputedStyle.bind(window);
    const spy = vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
      if (el === panel) return { transform: "matrix(1, 0, 0, 1, 0, 120)" } as CSSStyleDeclaration;
      if (el === scrim) return { opacity: "0.4" } as CSSStyleDeclaration;
      return real(el, pseudo);
    });
    try {
      fireEvent.pointerDown(screen.getByTestId("handle"), { clientY: 10, pointerId: 1 });
      expect(panel.style.transition).toBe("none");
      expect(panel.style.transform).toBe("translate3d(0, 120px, 0)");
      expect(scrim.style.transition).toBe("none");
      expect(scrim.style.opacity).toBe("0.4");
    } finally {
      spy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("rubber-bands upward travel instead of following it 1:1", () => {
    const { panel } = setup();
    const handle = screen.getByTestId("handle");
    fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 100, pointerId: 1 });
    const y = Number(/translate3d\(0, (-?[\d.]+)px/.exec(panel.style.transform)![1]);
    expect(y).toBeLessThan(0);
    expect(y).toBeGreaterThan(-100);
  });

  it("dismisses when released past the distance threshold", () => {
    const { onDismiss, onSettle } = setup();
    const handle = screen.getByTestId("handle");
    fireEvent.pointerDown(handle, { clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 400, pointerId: 1 });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSettle).not.toHaveBeenCalled();
  });
});
