import { describe, expect, it } from "vitest";
import type { NightClear } from "../api/types";
import { nightHeadline, roundHalfHourLocal } from "./nightHeadline";

const TZ = "America/New_York";
// Darkness 20:00 to 06:45 EST on 3-4 Nov 2026 (10 h 45 min).
const DARK_START = "2026-11-04T01:00:00Z";
const DARK_END = "2026-11-04T11:45:00Z";

function clear(startUtc: string, endUtc: string, minutes: number): NightClear {
  return { start_utc: startUtc, end_utc: endUtc, minutes, rule: "test" };
}

const base = { darkMinutes: 645, darkStartUtc: DARK_START, darkEndUtc: DARK_END, hasForecast: true, forecastMessage: null, tz: TZ };

describe("roundHalfHourLocal", () => {
  it("rounds 01:35 EST to 01:30", () => {
    expect(roundHalfHourLocal("2026-11-04T06:35:00Z", TZ)).toBe("01:30");
  });
  it("uses the observer's zone, including a 45-minute offset", () => {
    expect(roundHalfHourLocal("2026-11-03T20:10:00Z", "Asia/Kathmandu")).toBe("02:00");
  });
  it("wraps past midnight", () => {
    expect(roundHalfHourLocal("2026-11-04T04:50:00Z", TZ)).toBe("00:00");
  });
});

describe("nightHeadline", () => {
  it("says there is no forecast and passes the provider message through", () => {
    const h = nightHeadline({ ...base, clear: null, hasForecast: false, forecastMessage: "Open-Meteo is unreachable." });
    expect(h).toEqual({ title: "No forecast yet", detail: "Open-Meteo is unreachable." });
  });

  it("reports no forecast-clear darkness", () => {
    const h = nightHeadline({ ...base, clear: null });
    expect(h.title).toBe("No forecast-clear darkness");
    expect(h.detail).toBe("Cloud or rain is forecast through all 10 h 45 min of darkness.");
  });

  it("is clear all night when the run covers darkness within 6 minutes", () => {
    const h = nightHeadline({ ...base, clear: clear("2026-11-04T01:04:00Z", "2026-11-04T11:41:00Z", 645) });
    expect(h.title).toBe("Clear all night");
    expect(h.detail).toBe("10 h 45 min of 10 h 45 min of darkness is forecast clear.");
  });

  it("clear until when the run starts at dusk", () => {
    const h = nightHeadline({ ...base, clear: clear(DARK_START, "2026-11-04T06:35:00Z", 430) });
    expect(h.title).toBe("Clear until about 01:30");
    expect(h.detail).toBe("7 h 10 min of 10 h 45 min of darkness is forecast clear.");
  });

  it("clears around when the run ends at dawn", () => {
    const h = nightHeadline({ ...base, clear: clear("2026-11-04T03:30:00Z", DARK_END, 430) });
    expect(h.title).toBe("Clears around 22:30");
    expect(h.detail).toBe("7 h 10 min of 10 h 45 min of darkness is forecast clear.");
  });

  it("gives a range for a run in the middle of the night", () => {
    const h = nightHeadline({ ...base, clear: clear("2026-11-04T02:00:00Z", "2026-11-04T06:30:00Z", 270) });
    expect(h.title).toBe("Clear about 21:00–01:30");
    expect(h.detail).toBe("4 h 30 min of 10 h 45 min of darkness is forecast clear.");
  });
});
