import { useMemo } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { VisibilityResponse } from "../../api/types";
import { BAND_LABEL, bandSegments, skyBand } from "../../lib/sky";
import { useThemeColors } from "../../lib/theme";
import { formatTime, tzAbbrev } from "../../lib/time";

interface Row {
  t: number;
  alt: number;
  moon: number;
  sun: number;
  az: number;
  sep: number;
}

export function AltitudeChart({ data, minAlt }: { data: VisibilityResponse; minAlt: number }) {
  const tz = data.night.timezone;
  const c = useThemeColors();
  const s = data.visibility.series;
  const from = new Date(data.night.display_start_utc).getTime();
  const to = new Date(data.night.display_end_utc).getTime();

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (let i = 0; i < s.t_ms.length; i++) {
      const t = s.t_ms[i];
      if (t < from || t > to) continue;
      out.push({ t, alt: s.alt_deg[i], moon: s.moon_alt_deg[i], sun: s.sun_alt_deg[i], az: s.az_deg[i], sep: s.moon_sep_deg[i] });
    }
    return out;
  }, [s, from, to]);
  const bands = useMemo(() => bandSegments(s.t_ms, s.sun_alt_deg, from, to), [s, from, to]);
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = Math.ceil(from / 3_600_000) * 3_600_000; t <= to; t += 3_600_000) out.push(t);
    return out.filter((_, i) => i % (out.length > 10 ? 2 : 1) === 0);
  }, [from, to]);

  const best = data.visibility.best_window;
  const fav = data.score.forecast_window;

  return (
    <figure aria-label={`Altitude of ${data.target.name} versus local time in ${tz}. Minimum altitude ${minAlt} degrees.`}>
      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            {bands.map((b) => (
              <ReferenceArea key={`${b.band}-${b.start}`} x1={b.start} x2={b.end} fill={c.sky[b.band]} fillOpacity={1} strokeOpacity={0} ifOverflow="hidden" />
            ))}
            {best && (
              <ReferenceArea
                x1={new Date(best.start_utc).getTime()}
                x2={new Date(best.end_utc).getTime()}
                y1={minAlt}
                y2={90}
                fill={c.accent}
                fillOpacity={0.09}
                stroke={c.accent}
                strokeOpacity={0.35}
                ifOverflow="hidden"
              />
            )}
            {fav && (
              <ReferenceArea
                x1={new Date(fav.start_utc).getTime()}
                x2={new Date(fav.end_utc).getTime()}
                y1={86}
                y2={90}
                fill={c.ink2}
                fillOpacity={0.75}
                strokeOpacity={0}
                ifOverflow="hidden"
              />
            )}
            <CartesianGrid stroke={c.line} strokeOpacity={0.45} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={[from, to]}
              ticks={ticks}
              tickFormatter={(v: number) => formatTime(v, tz)}
              stroke={c.muted}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: c.line }}
            />
            <YAxis domain={[-10, 90]} ticks={[0, 30, 60, 90]} tickFormatter={(v: number) => `${v}°`} stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
            <ReferenceLine y={minAlt} stroke={c.ink2} strokeDasharray="4 4" strokeOpacity={0.6} />
            <ReferenceLine y={0} stroke={c.muted} strokeOpacity={0.5} />
            <Line type="monotone" dataKey="moon" name="Moon" stroke={c.ink} strokeOpacity={0.7} strokeDasharray="3 3" dot={false} strokeWidth={1.5} isAnimationActive={false} />
            <Line type="monotone" dataKey="alt" name={data.target.name} stroke={c.accent} dot={false} strokeWidth={2.2} isAnimationActive={false} />
            <Tooltip content={<AltTooltip tz={tz} name={data.target.name} />} cursor={{ stroke: c.accent, strokeOpacity: 0.5 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-ice" />{data.target.name}</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-ink/70" />Moon</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-ink-2/70" />{minAlt}° limit</span>
        {best && <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-ice/20 ring-1 ring-ice/50" />Best window</span>}
        {fav && <span className="inline-flex items-center gap-1.5"><span className="h-1 w-4 bg-ink-2" />Forecast-favorable</span>}
        <span>Times in {tz}</span>
      </figcaption>
    </figure>
  );
}

function AltTooltip({ active, payload, tz, name }: { active?: boolean; payload?: { payload: Row }[]; tz: string; name: string }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-lg border border-line bg-night-deep px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-ink">
        {formatTime(r.t, tz)} {tzAbbrev(r.t, tz)}
      </p>
      <p className="text-ice">
        {name}: {r.alt.toFixed(1)}° alt, az {r.az.toFixed(0)}°
      </p>
      <p className="text-ink-2">Moon {r.moon.toFixed(1)}° · {r.sep.toFixed(0)}° from target</p>
      <p className="text-muted">{BAND_LABEL[skyBand(r.sun)]}</p>
    </div>
  );
}
