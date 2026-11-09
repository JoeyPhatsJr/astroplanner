import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ForecastPayload, HourlyRow, NightSummary } from "../../api/types";
import { NightStrip } from "./NightStrip";

afterEach(cleanup);

const TZ = "America/New_York";
const HOUR = 3600_000;
const START = Date.parse("2026-11-03T22:00:00Z"); // 17:00 EST
const END = Date.parse("2026-11-04T11:00:00Z"); // 06:00 EST

function night(moonAlt: (t: number) => number): NightSummary {
  const t_ms: number[] = [];
  for (let t = START; t <= END; t += HOUR) t_ms.push(t);
  return {
    night_date: "2026-11-03",
    timezone: TZ,
    span_start_utc: new Date(START).toISOString(),
    span_end_utc: new Date(END).toISOString(),
    span_hours: 13,
    display_start_utc: new Date(START).toISOString(),
    display_end_utc: new Date(END).toISOString(),
    events: {
      sunset_utc: "2026-11-03T22:05:00Z",
      civil_dusk_utc: "2026-11-03T22:35:00Z",
      nautical_dusk_utc: "2026-11-03T23:10:00Z",
      astronomical_dusk_utc: "2026-11-03T23:45:00Z",
      astronomical_dawn_utc: "2026-11-04T09:45:00Z",
      nautical_dawn_utc: "2026-11-04T10:20:00Z",
      civil_dawn_utc: "2026-11-04T10:55:00Z",
      sunrise_utc: null,
    },
    dark_intervals: [{ start_utc: "2026-11-03T23:45:00Z", end_utc: "2026-11-04T09:45:00Z" }],
    dark_minutes: 600,
    has_darkness: true,
    series: { t_ms, sun_alt_deg: t_ms.map(() => -30), moon_alt_deg: t_ms.map(moonAlt), moon_illumination: t_ms.map(() => 0.5) },
  } as unknown as NightSummary;
}

function row(t_ms: number, cloud: number | null): HourlyRow {
  return {
    t_ms, cloud_cover: cloud, cloud_cover_low: null, cloud_cover_mid: null, cloud_cover_high: null,
    precipitation_probability: 10, precipitation: null, relative_humidity_2m: null, dew_point_2m: null,
    temperature_2m: null, wind_speed_10m: null, visibility: null,
  };
}

function forecast(hourly: HourlyRow[]): ForecastPayload {
  return {
    status: hourly.length ? "ok" : "unavailable", reason_code: null, message: null,
    source: { provider: "Open-Meteo", url: "", terms_url: "", license: "", note: "" },
    retrieved_at_utc: null, from_cache: false, lead_time_hours: 4,
    confidence: { label: "higher", kind: "x", explanation: "x" }, hourly, missing: {}, units: {},
  } as ForecastPayload;
}

const hours = (n: number, cloudAt: (i: number) => number | null) =>
  Array.from({ length: n }, (_, i) => row(START + i * HOUR, cloudAt(i)));

describe("NightStrip", () => {
  it("renders one cell per hourly value in range, with observer-zone hour labels", () => {
    const { container } = render(
      <NightStrip night={night(() => -20)} forecast={forecast(hours(13, () => 40))} clear={null} bestWindow={null} tz={TZ} />,
    );
    expect(container.querySelectorAll("[data-cell]").length).toBe(13);
    const svg = container.querySelector("svg") as SVGElement;
    expect(within(svg as unknown as HTMLElement).getByText("18")).toBeTruthy();
    expect(within(svg as unknown as HTMLElement).getByText("20")).toBeTruthy();
  });

  it("draws no cloud rectangle for a null cloud_cover", () => {
    const { container } = render(
      <NightStrip night={night(() => -20)} forecast={forecast(hours(3, (i) => (i === 1 ? null : 50)))} clear={null} bestWindow={null} tz={TZ} />,
    );
    expect(container.querySelectorAll("[data-cell]").length).toBe(3);
    expect(container.querySelectorAll("[data-cloud]").length).toBe(2);
  });

  it("shows the empty state and no clear bar when there is no hourly data", () => {
    const { container } = render(
      <NightStrip
        night={night(() => -20)}
        forecast={forecast([])}
        clear={{ start_utc: "2026-11-04T01:00:00Z", end_utc: "2026-11-04T04:00:00Z", minutes: 180, rule: "x" }}
        bestWindow={null}
        tz={TZ}
      />,
    );
    expect(screen.getByText("No forecast this far ahead")).toBeTruthy();
    expect(container.querySelector("[data-clearbar]")).toBeNull();
  });

  it("draws a Moon band only while the Moon is above the horizon", () => {
    const down = render(<NightStrip night={night(() => -20)} forecast={forecast(hours(13, () => 10))} clear={null} bestWindow={null} tz={TZ} />);
    expect(down.container.querySelector("[data-moon]")).toBeNull();
    down.unmount();
    const up = render(
      <NightStrip night={night((t) => (t < START + 4 * HOUR ? 25 : -10))} forecast={forecast(hours(13, () => 10))} clear={null} bestWindow={null} tz={TZ} />,
    );
    expect(up.container.querySelector("[data-moon]")).not.toBeNull();
  });

  it("lists exact values in a screen-reader table and reads a cell on pointer move", () => {
    const { container } = render(
      <NightStrip night={night(() => -20)} forecast={forecast(hours(13, () => 40))} clear={null} bestWindow={null} tz={TZ} />,
    );
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row").length).toBe(14);
    expect(within(table).getByText("17:00")).toBeTruthy();
    const hit = container.querySelector("[data-hit]") as Element;
    fireEvent.pointerMove(hit, { clientX: 10, clientY: 40 });
    expect(screen.getByTestId("strip-tip").textContent).toBe("17:00: cloud 40 %, rain chance 10 %");
  });
});
