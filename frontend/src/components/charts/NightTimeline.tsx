import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ForecastPayload, NightSummary } from "../../api/types";
import { BAND_FILL, BAND_LABEL, bandSegments, nearestHour, skyBand } from "../../lib/sky";
import { useThemeColors } from "../../lib/theme";
import { formatTime, tzAbbrev } from "../../lib/time";

interface Row {
  t: number;
  moon: number;
  sun: number;
  cloud: number | null;
  precip: number | null;
}

export function NightTimeline({ night, forecast }: { night: NightSummary; forecast: ForecastPayload }) {
  const tz = night.timezone;
  const c = useThemeColors();
  const from = new Date(night.display_start_utc).getTime();
  const to = new Date(night.display_end_utc).getTime();

  const rows = useMemo<Row[]>(() => {
    const s = night.series;
    const out: Row[] = [];
    for (let i = 0; i < s.t_ms.length; i++) {
      const t = s.t_ms[i];
      if (t < from || t > to) continue;
      const h = forecast.status === "ok" ? nearestHour(forecast.hourly, t) : null;
      out.push({
        t,
        moon: s.moon_alt_deg[i],
        sun: s.sun_alt_deg[i],
        cloud: h?.cloud_cover ?? null,
        precip: h?.precipitation_probability ?? null,
      });
    }
    return out;
  }, [night, forecast, from, to]);

  const bands = useMemo(() => bandSegments(night.series.t_ms, night.series.sun_alt_deg, from, to), [night, from, to]);
  const hourTicks = useMemo(() => {
    const ticks: number[] = [];
    const first = Math.ceil(from / 3_600_000) * 3_600_000;
    for (let t = first; t <= to; t += 3_600_000) ticks.push(t);
    const step = ticks.length > 14 ? 2 : 1;
    return ticks.filter((_, i) => i % step === 0);
  }, [from, to]);

  const summary = `Night timeline from ${formatTime(from, tz)} to ${formatTime(to, tz)} ${tzAbbrev(from, tz)}. Moon peaks at ${Math.round(
    Math.max(...rows.map((r) => r.moon)),
  )}°.`;

  return (
    <figure className="flex flex-col gap-3" aria-label={summary}>
      <div className="h-[260px] w-full md:h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            {bands.map((b) => (
              <ReferenceArea
                key={`${b.band}-${b.start}`}
                x1={b.start}
                x2={b.end}
                yAxisId="alt"
                fill={c.sky[b.band]}
                fillOpacity={1}
                strokeOpacity={0}
                ifOverflow="hidden"
              />
            ))}
            <CartesianGrid stroke={c.line} strokeOpacity={0.45} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={[from, to]}
              ticks={hourTicks}
              tickFormatter={(v: number) => formatTime(v, tz)}
              stroke={c.muted}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: c.line }}
            />
            <YAxis
              yAxisId="alt"
              domain={[-10, 90]}
              ticks={[0, 30, 60, 90]}
              tickFormatter={(v: number) => `${v}°`}
              stroke={c.muted}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <YAxis
              yAxisId="pct"
              orientation="right"
              domain={[0, 100]}
              ticks={[0, 50, 100]}
              tickFormatter={(v: number) => `${v}%`}
              stroke={c.muted}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Area
              yAxisId="pct"
              type="stepAfter"
              dataKey="cloud"
              name="Cloud cover"
              stroke={c.ink2}
              strokeOpacity={0.55}
              fill={c.ink2}
              fillOpacity={0.16}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              yAxisId="pct"
              type="stepAfter"
              dataKey="precip"
              name="Precipitation probability"
              stroke={c.accent}
              strokeDasharray="4 3"
              dot={false}
              strokeWidth={1.5}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              yAxisId="alt"
              type="monotone"
              dataKey="moon"
              name="Moon altitude"
              stroke={c.ink}
              strokeDasharray="5 4"
              dot={false}
              strokeWidth={1.8}
              isAnimationActive={false}
            />
            <Tooltip content={<TimelineTooltip tz={tz} />} cursor={{ stroke: c.accent, strokeOpacity: 0.5 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
        <Legend swatch={<span className="h-0 w-4 border-t-2 border-dashed border-ink" />} label="Moon altitude (left axis)" />
        <Legend swatch={<span className="h-2.5 w-4 rounded-sm bg-ink-2/25 ring-1 ring-ink-2/50" />} label="Cloud cover (right axis)" />
        <Legend swatch={<span className="h-0 w-4 border-t-2 border-dashed border-ice" />} label="Precipitation probability" />
        {(["day", "civil", "nautical", "astronomical", "dark"] as const).map((b) => (
          <Legend key={b} swatch={<span className="size-2.5 rounded-sm ring-1 ring-line" style={{ background: BAND_FILL[b] }} />} label={BAND_LABEL[b]} />
        ))}
        <span>Times in {tz}</span>
      </figcaption>
    </figure>
  );
}

function Legend({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {swatch}
      {label}
    </span>
  );
}

function TimelineTooltip({ active, payload, tz }: { active?: boolean; payload?: { payload: Row }[]; tz: string }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-lg border border-line bg-night-deep px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-ink">
        {formatTime(r.t, tz)} {tzAbbrev(r.t, tz)}
      </p>
      <p className="text-muted">{BAND_LABEL[skyBand(r.sun)]} (Sun {r.sun.toFixed(1)}°)</p>
      <p className="mt-1 text-ink">Moon {r.moon.toFixed(1)}°{r.moon < -0.833 ? " (below horizon)" : ""}</p>
      <p className="text-ink-2">Cloud {r.cloud === null ? "no forecast" : `${r.cloud}%`}</p>
      <p className="text-ice">Precip. probability {r.precip === null ? "no forecast" : `${r.precip}%`}</p>
    </div>
  );
}
