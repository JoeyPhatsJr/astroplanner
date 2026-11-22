import { describe, expect, it } from "vitest";
import { forecastGap, forecastReason, weatherReason } from "./forecastGap";

describe("forecastGap", () => {
  it("says 'too far ahead' only for nights past the forecast horizon", () => {
    expect(forecastGap({ status: "unavailable", reason_code: "beyond_forecast_horizon" }).title).toBe("No forecast this far ahead");
    expect(forecastGap({ status: "unavailable", reason_code: "out_of_range" }).note).toBe("beyond forecast range");
  });

  it.each(["rate_limited", "network_error", "provider_error", "empty_response"])(
    "calls a failed request (%s) unavailable, not out of range",
    (reason_code) => {
      expect(forecastGap({ status: "error", reason_code })).toEqual({ title: "Forecast unavailable right now", note: "forecast unavailable" });
    },
  );

  it("names old nights and plain gaps for what they are", () => {
    expect(forecastGap({ status: "unavailable", reason_code: "before_forecast_archive" }).note).toBe("older than the forecast archive");
    expect(forecastGap({ status: "ok", reason_code: null }).title).toBe("No forecast for these hours");
  });
});

describe("forecastReason", () => {
  it("is null when there is a forecast", () => {
    expect(forecastReason({ status: "ok", reason_code: null, message: null })).toBeNull();
  });

  it("puts Open-Meteo's quota error in plain words", () => {
    const r = forecastReason({
      status: "error",
      reason_code: "rate_limited",
      message: "Open-Meteo: Daily API request limit exceeded. Please try again tomorrow.",
    });
    expect(r).toBe("The weather service has reached its request limit for now, so there’s no forecast yet.");
    expect(weatherReason("Open-Meteo: Minutely API request limit exceeded.")).toBe(r);
  });

  it("says when the weather service can't be reached", () => {
    expect(forecastReason({ status: "error", reason_code: "network_error", message: "Could not reach Open-Meteo (ConnectError)." }))
      .toMatch(/can’t be reached/);
  });

  it("passes the API's own wording through otherwise", () => {
    const message = "Open-Meteo forecasts extend about 16 days ahead (to 2026-12-07 UTC). Astronomy for this night is still calculated.";
    expect(forecastReason({ status: "unavailable", reason_code: "beyond_forecast_horizon", message })).toBe(message);
    expect(weatherReason(null)).toBe("The weather forecast is not available for this night.");
  });
});
