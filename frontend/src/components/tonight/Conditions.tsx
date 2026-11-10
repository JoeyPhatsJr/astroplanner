import type { ForecastPayload, NightSummary } from "../../api/types";
import { formatAge, formatDateTime, formatDuration, formatTime, tzAbbrev } from "../../lib/time";

function darkHourly(forecast: ForecastPayload, night: NightSummary) {
  const spans = night.dark_intervals.map((d) => [new Date(d.start_utc).getTime(), new Date(d.end_utc).getTime()] as const);
  return forecast.hourly.filter((h) => spans.some(([s, e]) => h.t_ms >= s - 1800_000 && h.t_ms <= e + 1800_000));
}

function stats(vals: (number | null)[]) {
  const v = vals.filter((x): x is number => x !== null);
  if (!v.length) return null;
  return { mean: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v), n: v.length, missing: vals.length - v.length };
}

function Fact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-ink">
        {value}
        <small className="block text-label font-normal text-muted">{note}</small>
      </dd>
    </div>
  );
}

/** Four plain numbers under the strip: cloud, rain, Moon, darkness. Absent forecast reads "No data", never zero. */
export function FactsRow({ night, forecast }: { night: NightSummary; forecast: ForecastPayload }) {
  const tz = night.timezone;
  const rows = forecast.status === "ok" ? (night.has_darkness ? darkHourly(forecast, night) : forecast.hourly) : [];
  const cloud = stats(rows.map((r) => r.cloud_cover));
  const rain = stats(rows.map((r) => r.precipitation_probability));
  const noData = "beyond forecast range";
  const first = night.dark_intervals[0];
  const last = night.dark_intervals[night.dark_intervals.length - 1];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line-soft pt-4 md:grid-cols-4">
      <Fact
        label="Cloud, average"
        value={cloud ? `${Math.round(cloud.mean)} %` : "No data"}
        note={cloud ? `range ${cloud.min}–${cloud.max} %${cloud.missing ? `, ${cloud.missing} h missing` : ""}` : noData}
      />
      <Fact
        label="Rain chance, peak"
        value={rain ? `${Math.round(rain.max)} %` : "No data"}
        note={rain ? `forecast${rain.missing ? `, ${rain.missing} h missing` : ""}` : noData}
      />
      <Fact
        label="Moon"
        value={`${Math.round(night.moon.illumination * 100)} %`}
        note={
          night.moon.up_fraction_of_dark <= 0
            ? `down all ${night.has_darkness ? "darkness" : "night"}`
            : night.moon.up_fraction_of_dark >= 1
              ? `up all ${night.has_darkness ? "darkness" : "night"}`
              : `up ${Math.round(night.moon.up_fraction_of_dark * 100)} % of ${night.has_darkness ? "darkness" : "the night"}`
        }
      />
      <Fact
        label={night.darkness === "nautical" ? "Nautical darkness" : "Darkness"}
        value={night.has_darkness ? formatDuration(night.dark_minutes) : "None"}
        note={
          night.has_darkness
            ? `${formatTime(first.start_utc, tz)}–${formatTime(last.end_utc, tz)} ${tzAbbrev(first.start_utc, tz)}`
            : `Sun stays above ${night.darkness_threshold_deg}°`
        }
      />
    </dl>
  );
}

const CONFIDENCE_TEXT: Record<string, string> = {
  higher: "Short lead time",
  moderate: "1–3 days ahead",
  low: "More than 3 days ahead: treat as rough",
  past_or_current: "Night has started or passed",
};

export function ForecastMeta({ forecast, tz }: { forecast: ForecastPayload; tz: string }) {
  if (forecast.status !== "ok") {
    return (
      <p className="text-sm text-ink-2">
        <span className="font-semibold text-warn">Weather unavailable.</span> {forecast.message}{" "}
        <span className="text-muted">Astronomy below is still calculated.</span>
      </p>
    );
  }
  const missing = Object.entries(forecast.missing);
  return (
    <div className="flex flex-col gap-1 text-xs text-muted">
      <p>
        Forecast from{" "}
        <a href={forecast.source.url} target="_blank" rel="noreferrer" className="text-ice hover:underline">
          {forecast.source.provider}
        </a>{" "}
        ({forecast.source.license}). {forecast.source.note}
      </p>
      <p>
        Retrieved {forecast.retrieved_at_utc ? `${formatDateTime(forecast.retrieved_at_utc, tz)} (${formatAge(forecast.retrieved_at_utc)})` : "time unknown"}
        {forecast.from_cache ? ", served from a 30-minute cache" : ""}. Lead time {forecast.lead_time_hours > 0 ? `${forecast.lead_time_hours} h` : "none"}:{" "}
        <span className="text-ink-2" title={forecast.confidence.explanation}>
          {CONFIDENCE_TEXT[forecast.confidence.label]}
        </span>
        .
      </p>
      {forecast.note && <p className="text-ice">Note: {forecast.note}</p>}
      {missing.length > 0 && <p className="text-warn">Missing values: {missing.map(([k, n]) => `${k.replace(/_/g, " ")} (${n} h)`).join(", ")}. Missing hours are not treated as clear.</p>}
    </div>
  );
}
