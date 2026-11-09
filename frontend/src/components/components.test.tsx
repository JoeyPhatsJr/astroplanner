import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { History } from "../api/astrolog";
import { TargetCard } from "./targets/TargetCard";
import type { Recommendation } from "../api/types";
import { HistoryBadge } from "./astrolog/HistoryBadge";
import type { SessionTarget, TonightScore } from "../api/types";
import { pickSessionForNight, sessionTitleForNight } from "../state/activeSession";
import { moveId, SessionTargetList } from "./session/SessionTargetList";
import { ScoreHero } from "./tonight/ScoreHero";
import { PageHeader } from "./ui/PageHeader";
import { BasisBadge } from "./ui/States";

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
