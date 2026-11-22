import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOURLY_VARS,
  OPEN_METEO_URL,
  RELAY_REFRESH_MS,
  browserForecastQuery,
  forecastClientId,
  relayBrowserForecast,
  resetBrowserForecasts,
} from "./browserForecast";

const NOW = Date.UTC(2026, 10, 22, 20, 0); // 2026-11-22T20:00Z
const place = { lat: 39.95261, lon: -75.16522, date: "2026-11-22", timezone: "America/New_York" };

describe("browserForecastQuery", () => {
  it("asks for the UTC days around the night, with every variable the API needs", () => {
    const q = browserForecastQuery(place, NOW)!;
    expect(q.get("start_date")).toBe("2026-11-21");
    expect(q.get("end_date")).toBe("2026-11-24");
    expect(q.get("latitude")).toBe("39.9526");
    expect(q.get("timeformat")).toBe("unixtime");
    expect(q.get("timezone")).toBe("GMT");
    expect(q.get("hourly")!.split(",")).toEqual([...HOURLY_VARS]);
  });

  it("stays inside the days Open-Meteo serves", () => {
    const q = browserForecastQuery({ ...place, date: "2026-12-06" }, NOW)!; // today + 14
    expect(q.get("end_date")).toBe("2026-12-07"); // today + 15, not + 16
  });

  it("asks nothing for nights outside the forecast window", () => {
    expect(browserForecastQuery({ ...place, date: "2026-12-07" }, NOW)).toBeNull();
    expect(browserForecastQuery({ ...place, date: "2026-08-01" }, NOW)).toBeNull();
  });
});

describe("relayBrowserForecast", () => {
  beforeEach(() => resetBrowserForecasts());

  it("fetches from Open-Meteo without cookies and hands the answer over", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"hourly":{}}', { status: 200 }));
    const post = vi.fn().mockResolvedValue({ used: true });
    await relayBrowserForecast(place, post, { fetchFn, now: NOW });
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url).startsWith(`${OPEN_METEO_URL}?`)).toBe(true);
    expect(init.credentials).toBe("omit");
    expect(post).toHaveBeenCalledWith('{"hourly":{}}');
  });

  it("asks once per place and night until the API would have forgotten it", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const post = vi.fn().mockResolvedValue({});
    await relayBrowserForecast(place, post, { fetchFn, now: NOW });
    await relayBrowserForecast({ ...place, lat: 39.952 }, post, { fetchFn, now: NOW + 1000 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await relayBrowserForecast(place, post, { fetchFn, now: NOW + RELAY_REFRESH_MS + 1 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("hands nothing over when Open-Meteo refuses this browser, and never throws", async () => {
    const post = vi.fn();
    await relayBrowserForecast(place, post, {
      fetchFn: vi.fn().mockResolvedValue(new Response('{"error":true}', { status: 429 })),
      now: NOW,
    });
    expect(post).not.toHaveBeenCalled();
    resetBrowserForecasts();
    await expect(
      relayBrowserForecast(place, post, { fetchFn: vi.fn().mockRejectedValue(new TypeError("offline")), now: NOW }),
    ).resolves.toBeUndefined();
    resetBrowserForecasts();
    const failingPost = vi.fn().mockRejectedValue(new Error("422"));
    await expect(
      relayBrowserForecast(place, failingPost, { fetchFn: vi.fn().mockResolvedValue(new Response("{}")), now: NOW }),
    ).resolves.toBeUndefined();
  });

  it("does not fetch for a night outside the forecast window", async () => {
    const fetchFn = vi.fn();
    await relayBrowserForecast({ ...place, date: "2027-01-01" }, vi.fn(), { fetchFn, now: NOW });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("forecastClientId", () => {
  it("is stable for the tab and shaped as the API expects", () => {
    const id = forecastClientId();
    expect(id).toMatch(/^[A-Za-z0-9-]{16,64}$/);
    expect(forecastClientId()).toBe(id);
  });
});
