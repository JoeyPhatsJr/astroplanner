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

/**
 * One plain sentence on why there is no forecast, for people rather than for the log. Open-Meteo's own
 * wording ("Daily API request limit exceeded…") reads like an error dump; the other reasons are already
 * written by the API for people and pass through.
 */
export function forecastReason(forecast: Pick<ForecastPayload, "status" | "reason_code" | "message">): string | null {
  if (forecast.status === "ok") return null;
  return weatherReason(forecast.message, forecast.reason_code);
}

/** As forecastReason, for responses that carry only the API's message (recommendations, visibility). */
export function weatherReason(message: string | null | undefined, reasonCode?: string | null): string {
  if (reasonCode === "rate_limited" || /limit exceeded/i.test(message ?? "")) {
    return "The weather service has reached its request limit for now, so there’s no forecast yet.";
  }
  if (reasonCode === "network_error" || /could not reach open-meteo/i.test(message ?? "")) {
    return "The weather service can’t be reached right now, so there’s no forecast yet.";
  }
  return message || "The weather forecast is not available for this night.";
}
