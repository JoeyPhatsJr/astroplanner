import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TonightResponse } from "../api/types";
import { TonightPanels } from "./TonightPage";

// The strip and score have their own tests; here only the panel's layout matters.
vi.mock("../components/tonight/NightStrip", () => ({ NightStrip: () => <div data-testid="strip" /> }));
vi.mock("../components/tonight/ScoreHero", () => ({ ScoreHero: () => <div data-testid="score" /> }));

afterEach(cleanup);

const data = {
  night: {
    timezone: "America/New_York",
    display_start_utc: "2026-11-03T22:00:00Z",
    has_darkness: true,
    darkness: "astronomical",
    darkness_threshold_deg: -18,
    dark_minutes: 600,
    dark_intervals: [{ start_utc: "2026-11-03T23:45:00Z", end_utc: "2026-11-04T09:45:00Z" }],
    moon: { illumination: 0.5, up_fraction_of_dark: 0 },
    series: { t_ms: [], sun_alt_deg: [], moon_alt_deg: [], moon_illumination: [] },
    notes: [],
  },
  forecast: { status: "unavailable", message: "No forecast", hourly: [], missing: {} },
  score: { status: "no_weather", total: null, window: null, components: [], darkness: "astronomical" },
  night_clear: null,
} as unknown as TonightResponse;

describe("TonightPanels", () => {
  it("draws one divider between the score/strip row and the facts", () => {
    render(
      <MemoryRouter>
        <TonightPanels data={data} tz="America/New_York" fetching={false} />
      </MemoryRouter>,
    );
    const panel = screen.getByRole("region", { name: "Tonight’s conditions" });
    const ruled = [panel, ...Array.from(panel.querySelectorAll("*"))].filter((el) => el.classList.contains("border-t"));
    expect(ruled).toHaveLength(1);
    const facts = panel.querySelector("dl") as HTMLElement;
    expect(ruled[0].contains(facts)).toBe(true);
    expect(ruled[0].contains(screen.getByTestId("strip"))).toBe(false);
  });
});
