import { describe, expect, it } from "vitest";
import type { HourlyRow, NightClear } from "../api/types";
import { darkForecastGaps, nightHeadline, roundHalfHourLocal } from "./nightHeadline";

const TZ = "America/New_York";
// Darkness 20:00 to 06:45 EST on 3-4 Nov 2026 (10 h 45 min).
const DARK_START = "2026-11-04T01:00:00Z";
const DARK_END = "2026-11-04T11:45:00Z";

function clear(startUtc: string, endUtc: string, minutes: number): NightClear {
  return { start_utc: startUtc, end_utc: endUtc, minutes, rule: "test" };
}

const base = {
  darkMinutes: 645,
  darkStartUtc: DARK_START,
  darkEndUtc: DARK_END,
  hasDarkness: true,
  darkness: "astronomical" as const,
  hasForecast: true,
  scoreStatus: "ok" as const,
  missingDarkMinutes: 0,
  clearEndsAtMissing: false,
  forecastMessage: null,
  tz: TZ,
};

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

  it("says nothing about cloud when there is no darkness", () => {
    const h = nightHeadline({ ...base, clear: null, hasDarkness: false, darkMinutes: 0, darkStartUtc: null, darkEndUtc: null, scoreStatus: "no_darkness" });
    expect(h.title).toBe("No darkness on this night");
    expect(h.detail).toBe("The Sun stays too high for astronomical darkness, so there are no dark hours to forecast.");
    expect(`${h.title} ${h.detail}`).not.toMatch(/cloud|rain|0 min/i);
  });

  it("reads as no forecast when the forecast has no usable values in darkness", () => {
    const h = nightHeadline({ ...base, clear: null, scoreStatus: "no_weather" });
    expect(h.title).toBe("No forecast yet");
    expect(h.detail).toBe("The forecast has no cloud or rain values for this night's darkness yet.");
    expect(h.detail).not.toMatch(/forecast through/);
  });

  it("with a partial forecast and no clear run, says how much darkness has no forecast and drops 'through all'", () => {
    const h = nightHeadline({ ...base, clear: null, scoreStatus: "partial_weather", missingDarkMinutes: 180 });
    expect(h.title).toBe("No forecast-clear darkness");
    expect(h.detail).toBe("Cloud or rain is forecast wherever the forecast reaches. 3 h of the 10 h 45 min of darkness has no forecast.");
    expect(h.detail).not.toMatch(/through all/);
  });

  it("with a partial forecast and a clear run, adds the hours without a forecast", () => {
    const h = nightHeadline({ ...base, clear: clear("2026-11-04T02:00:00Z", "2026-11-04T06:30:00Z", 270), scoreStatus: "partial_weather", missingDarkMinutes: 120 });
    expect(h.detail).toBe("4 h 30 min of 10 h 45 min of darkness is forecast clear. 2 h of it has no forecast.");
  });

  it("does not imply cloud arrives when a clear run from dusk ends where the forecast stops", () => {
    const h = nightHeadline({
      ...base,
      clear: clear(DARK_START, "2026-11-04T06:35:00Z", 430),
      scoreStatus: "partial_weather",
      missingDarkMinutes: 310,
      clearEndsAtMissing: true,
    });
    expect(h.title).toBe("Forecast clear until about 01:30; no forecast after");
  });

  it("gives a range when a mid-night clear run ends where the forecast stops", () => {
    const h = nightHeadline({
      ...base,
      clear: clear("2026-11-04T02:00:00Z", "2026-11-04T06:30:00Z", 270),
      scoreStatus: "partial_weather",
      missingDarkMinutes: 315,
      clearEndsAtMissing: true,
    });
    expect(h.title).toBe("Forecast clear about 21:00–01:30; no forecast after");
  });
});

describe("darkForecastGaps", () => {
  const FIVE = 5 * 60_000;
  const t0 = Date.parse(DARK_START) - 3_600_000;
  const t1 = Date.parse(DARK_END) + 3_600_000;
  const t_ms: number[] = [];
  for (let t = t0; t <= t1; t += FIVE) t_ms.push(t);
  const sun = t_ms.map((t) => (t >= Date.parse(DARK_START) && t < Date.parse(DARK_END) ? -30 : 0));
  const night = { series: { t_ms, sun_alt_deg: sun, moon_alt_deg: [], moon_illumination: [] }, darkness_threshold_deg: -18 };
  const row = (iso: string, cloud: number | null, rain: number | null = 0): HourlyRow => ({
    t_ms: Date.parse(iso), cloud_cover: cloud, precipitation_probability: rain,
    cloud_cover_low: null, cloud_cover_mid: null, cloud_cover_high: null, precipitation: null,
    relative_humidity_2m: null, dew_point_2m: null, temperature_2m: null, wind_speed_10m: null, visibility: null,
  });
  // Hourly forecast that stops after 06:00 UTC (01:00 EST): 01:00..06:00 UTC.
  const hourly = ["01", "02", "03", "04", "05", "06"].map((h) => row(`2026-11-04T${h}:00:00Z`, 5));

  it("counts dark minutes with no usable forecast within 30 minutes", () => {
    // The 06:00 row covers samples through 06:30 UTC; dark samples 06:35–11:40 (62 × 5 min) have none.
    expect(darkForecastGaps(night, hourly, null).missingDarkMinutes).toBe(310);
  });

  it("treats null values as missing", () => {
    const withNull = [...hourly.slice(0, 5), row("2026-11-04T06:00:00Z", null)];
    // Samples nearest the null 06:00 row (05:35 onward) are missing, as on the server.
    expect(darkForecastGaps(night, withNull, null).missingDarkMinutes).toBe(370);
  });

  it("flags a clear run that ends where the forecast stops", () => {
    const run = clear(DARK_START, "2026-11-04T06:35:00Z", 335);
    expect(darkForecastGaps(night, hourly, run).clearEndsAtMissing).toBe(true);
  });

  it("does not flag a clear run that ends where cloud arrives", () => {
    const cloudy = [...hourly, ...["07", "08", "09", "10", "11", "12"].map((h) => row(`2026-11-04T${h}:00:00Z`, 90))];
    const run = clear(DARK_START, "2026-11-04T06:35:00Z", 335);
    const gaps = darkForecastGaps(night, cloudy, run);
    expect(gaps.missingDarkMinutes).toBe(0);
    expect(gaps.clearEndsAtMissing).toBe(false);
  });

  it("does not flag a clear run that ends at dawn", () => {
    const full = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map((h) => row(`2026-11-04T${h}:00:00Z`, 5));
    expect(darkForecastGaps(night, full, clear(DARK_START, DARK_END, 645)).clearEndsAtMissing).toBe(false);
  });
});
