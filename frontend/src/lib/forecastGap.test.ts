import { describe, expect, it } from "vitest";
import { forecastGap } from "./forecastGap";

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
