import type { ForecastPayload } from "../api/types";

/**
 * Words for a night with no forecast rows, matched to why they are missing. Only a night past the
 * forecast horizon is "too far ahead"; a failed or rate-limited request is not, and saying so would
 * send people to the wrong conclusion about tonight.
 */
export function forecastGap(forecast: Pick<ForecastPayload, "status" | "reason_code">): { title: string; note: string } {
  switch (forecast.reason_code) {
    case "beyond_forecast_horizon":
    case "out_of_range":
      return { title: "No forecast this far ahead", note: "beyond forecast range" };
    case "before_forecast_archive":
      return { title: "No forecast kept for nights this old", note: "older than the forecast archive" };
  }
  if (forecast.status === "error") return { title: "Forecast unavailable right now", note: "forecast unavailable" };
  return { title: "No forecast for these hours", note: "no forecast" };
}
