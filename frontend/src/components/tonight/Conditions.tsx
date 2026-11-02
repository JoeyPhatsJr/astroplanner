import { Cloud, CloudRain, Moon, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { ForecastPayload, NightSummary } from "../../api/types";
import { formatAge, formatDateTime, formatDuration, formatTime, tzAbbrev } from "../../lib/time";
import { BasisBadge } from "../ui/States";

function darkHourly(forecast: ForecastPayload, night: NightSummary) {
  const spans = night.dark_intervals.map((d) => [new Date(d.start_utc).getTime(), new Date(d.end_utc).getTime()] as const);
  return forecast.hourly.filter((h) => spans.some(([s, e]) => h.t_ms >= s - 1800_000 && h.t_ms <= e + 1800_000));
}

function stats(vals: (number | null)[]) {
  const v = vals.filter((x): x is number => x !== null);
  if (!v.length) return null;
  return { mean: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v), n: v.length, missing: vals.length - v.length };
}

function Tile({ icon, title, basis, children }: { icon: ReactNode; title: string; basis: "forecast" | "calculated"; children: ReactNode }) {
  return (
    <div className="panel flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2 text-ink-2">
        <span className="text-ice">{icon}</span>
        <h3 className="min-w-0 text-sm font-semibold">{title}</h3>
        <span className="ml-auto shrink-0">
          <BasisBadge basis={basis} />
        </span>
      </div>
      {children}
    </div>
  );
}

export function ConditionTiles({ night, forecast }: { night: NightSummary; forecast: ForecastPayload }) {
  const tz = night.timezone;
  const rows = forecast.status === "ok" ? (night.has_darkness ? darkHourly(forecast, night) : forecast.hourly) : [];
  const cloud = stats(rows.map((r) => r.cloud_cover));
  const rain = stats(rows.map((r) => r.precipitation_probability));
  const scope = night.has_darkness ? "during darkness" : "overnight";
  const noForecast = <p className="text-sm text-muted">No forecast for this night.</p>;
  const ev = night.events;
  const moonEvents = night.moon.events.filter((e) => {
    const t = new Date(e.time_utc).getTime();
    return t >= new Date(night.display_start_utc).getTime() && t <= new Date(night.display_end_utc).getTime();
  });

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
      <Tile icon={<Cloud className="size-4" aria-hidden />} title="Clouds" basis="forecast">
        {cloud ? (
          <>
            <p className="font-semibold tracking-tight text-3xl text-ink">{Math.round(cloud.mean)}%</p>
            <p className="text-xs text-muted">
              Mean {scope} · range {cloud.min}–{cloud.max}%{cloud.missing ? ` · ${cloud.missing} h missing` : ""}
            </p>
          </>
        ) : (
          noForecast
        )}
      </Tile>
      <Tile icon={<CloudRain className="size-4" aria-hidden />} title="Rain risk" basis="forecast">
        {rain ? (
          <>
            <p className="font-semibold tracking-tight text-3xl text-ink">{Math.round(rain.max)}%</p>
            <p className="text-xs text-muted">
              Highest hourly precipitation probability {scope}
              {rain.missing ? ` · ${rain.missing} h missing` : ""}
            </p>
          </>
        ) : (
          noForecast
        )}
      </Tile>
      <Tile icon={<Moon className="size-4" aria-hidden />} title="Moon" basis="calculated">
        <p className="font-semibold tracking-tight text-3xl text-ink">{Math.round(night.moon.illumination * 100)}%</p>
        <p className="text-xs text-muted">
          {night.moon.phase_name} · up {Math.round(night.moon.up_fraction_of_dark * 100)}% of {night.has_darkness ? "darkness" : "the night"}
        </p>
        {moonEvents.length > 0 && (
          <p className="text-xs text-ink-2">
            {moonEvents.map((e) => `${e.event === "moonrise" ? "Rises" : "Sets"} ${formatTime(e.time_utc, tz)}`).join(" · ")}
          </p>
        )}
      </Tile>
      <Tile icon={<Sparkles className="size-4" aria-hidden />} title={night.darkness === "nautical" ? "Nautical darkness" : "Astronomical darkness"} basis="calculated">
        {night.has_darkness ? (
          <>
            <p className="font-semibold tracking-tight text-3xl text-ink">{formatDuration(night.dark_minutes)}</p>
            <p className="text-xs text-muted">
              {night.dark_intervals.map((d) => `${formatTime(d.start_utc, tz)}–${formatTime(d.end_utc, tz)}`).join(", ")} {tzAbbrev(night.dark_intervals[0].start_utc, tz)}
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-2">None tonight. Sun stays above {night.darkness_threshold_deg}° (lowest {night.sun_min_alt_deg.toFixed(1)}°).</p>
        )}
        {ev.sunset_utc && ev.sunrise_utc && (
          <p className="text-xs text-ink-2">
            Sunset {formatTime(ev.sunset_utc, tz)} · Sunrise {formatTime(ev.sunrise_utc, tz)}
          </p>
        )}
      </Tile>
    </div>
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
