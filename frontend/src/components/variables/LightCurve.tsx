import { useMemo } from "react";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import type { CurveResponse } from "../../api/variables";
import { useThemeColors } from "../../lib/theme";

const UNIX_JD_EPOCH = 2440587.5;
const DAY_MS = 86_400_000;
const jdToMs = (jd: number) => (jd - UNIX_JD_EPOCH) * DAY_MS;
const GAP_DAYS = 3;

/** Whole-magnitude bounds [brightest, faintest] covering the data, rounded outward; drawn reversed so brighter is up. */
export function curveYDomain(mags: number[]): [number, number] {
  if (mags.length === 0) return [8, 14];
  return [Math.floor(Math.min(...mags)), Math.ceil(Math.max(...mags))];
}

export function curveYTicks([lo, hi]: [number, number]): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) out.push(m);
  return out;
}

/**
 * Daily-mean rows for the line, with a null row inserted wherever two consecutive means are more than
 * GAP_DAYS apart, so the line breaks instead of interpolating across days with no observations.
 */
export function dailyLineRows(daily: [string, number, number][]): { t: number; mag: number | null; n?: number }[] {
  const out: { t: number; mag: number | null; n?: number }[] = [];
  let prev: number | null = null;
  for (const [d, mag, n] of daily) {
    const t = Date.parse(`${d}T12:00:00Z`);
    if (prev !== null && t - prev > GAP_DAYS * DAY_MS) out.push({ t: (prev + t) / 2, mag: null });
    out.push({ t, mag, n });
    prev = t;
  }
  return out;
}

const monthYear = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short", year: "2-digit" });
const dayMonth = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

/** Ticks at the first of each month (thinned when crowded), or evenly spaced days for short spans; labels never repeat. */
export function timeTicks(tMin: number, tMax: number): { ticks: number[]; label: (t: number) => string } {
  const months: number[] = [];
  const start = new Date(tMin);
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  for (let t = Date.UTC(y, m, 1); t <= tMax; t = Date.UTC(y, ++m, 1)) if (t >= tMin) months.push(t);
  if (months.length >= 3) {
    const step = Math.ceil(months.length / 8);
    return { ticks: months.filter((_, i) => i % step === 0), label: (t) => monthYear.format(new Date(t)) };
  }
  const days = Math.max(1, Math.floor((tMax - tMin) / DAY_MS));
  const stepDays = Math.max(1, Math.ceil(days / 5));
  const ticks: number[] = [];
  const first = Math.ceil(tMin / DAY_MS) * DAY_MS;
  for (let t = first; t <= tMax; t += stepDays * DAY_MS) ticks.push(t);
  return { ticks, label: (t) => dayMonth.format(new Date(t)) };
}

interface Row {
  t: number;
  mag: number | null;
  band: string;
  kind: "obs" | "daily" | "night";
  n?: number;
}

function dayLabel(t: number) {
  return new Date(t).toISOString().slice(0, 10);
}

export const Y_AXIS_LABEL = "Magnitude (V) · Brighter ↑";

export function LightCurve({ curve, nights }: { curve: CurveResponse; nights: string[] }) {
  const c = useThemeColors();
  const domain = useMemo(() => curveYDomain(curve.points.map((p) => p[1])), [curve.points]);
  const v = useMemo<Row[]>(() => curve.points.filter((p) => p[2] === "V").map((p) => ({ t: jdToMs(p[0]), mag: p[1], band: "V", kind: "obs" })), [curve.points]);
  const vis = useMemo<Row[]>(() => curve.points.filter((p) => p[2] !== "V").map((p) => ({ t: jdToMs(p[0]), mag: p[1], band: "Vis.", kind: "obs" })), [curve.points]);
  const daily = useMemo(() => dailyLineRows(curve.daily).map((r) => ({ ...r, band: "V + Vis.", kind: "daily" as const })), [curve.daily]);
  const tMin = useMemo(() => Math.min(...[...v, ...vis, ...daily].map((r) => r.t)), [v, vis, daily]);
  const tMax = useMemo(() => Math.max(...[...v, ...vis, ...daily].map((r) => r.t)), [v, vis, daily]);
  const yTicks = useMemo(() => curveYTicks(domain), [domain]);
  const xt = useMemo(() => timeTicks(tMin, tMax), [tMin, tMax]);
  // A night belongs to the evening's date; its middle is about the next UT midnight for a western observer.
  const nightMarks = useMemo<Row[]>(
    () =>
      nights
        .map((d) => Date.parse(`${d}T00:00:00Z`) + DAY_MS)
        .filter((t) => t >= tMin - DAY_MS && t <= tMax + DAY_MS)
        .map((t) => ({ t, mag: domain[1], band: "Your night", kind: "night" })),
    [nights, tMin, tMax, domain],
  );
  return (
    <figure aria-label={`Light curve for ${curve.window.label}. Brighter is up: the magnitude axis runs from fainter at the bottom to brighter at the top.`}>
      <div className="h-[280px] w-full md:h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={c.line} strokeOpacity={0.45} vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={[tMin, tMax]} ticks={xt.ticks} tickFormatter={xt.label} stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: c.line }} />
            <YAxis
              dataKey="mag"
              type="number"
              reversed
              domain={domain}
              ticks={yTicks}
              interval={0}
              allowDataOverflow
              stroke={c.muted}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={52}
              label={{ value: Y_AXIS_LABEL, angle: -90, position: "insideLeft", fill: c.muted, fontSize: 11, style: { textAnchor: "middle" } }}
            />
            <Scatter name="V" data={v} fill={c.ink2} fillOpacity={0.45} shape="circle" isAnimationActive={false} />
            <Scatter name="Vis." data={vis} fill={c.muted} fillOpacity={0.55} shape="diamond" isAnimationActive={false} />
            <Line name="Daily average" data={daily} dataKey="mag" type="linear" connectNulls={false} stroke={c.accent} strokeWidth={2} dot={false} isAnimationActive={false} />
            {nightMarks.length > 0 && <Scatter name="Your nights" data={nightMarks} fill={c.warn} shape="triangle" isAnimationActive={false} />}
            <Tooltip content={<CurveTooltip />} cursor={{ stroke: c.accent, strokeOpacity: 0.4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-ink-2/50" aria-hidden />V band</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rotate-45 bg-muted/60" aria-hidden />Visual (Vis.)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-ice" aria-hidden />Daily average</span>
        {nightMarks.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="text-warn" aria-hidden>▲</span>Your nights</span>}
      </figcaption>
    </figure>
  );
}

function CurveTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-lg border border-line bg-night-deep px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-ink">{dayLabel(r.t)} UT</p>
      {r.kind === "night" ? (
        <p className="text-ink-2">Your night</p>
      ) : (
        <>
          <p className="text-ice">{r.kind === "daily" ? `Daily average ${(r.mag as number).toFixed(2)} (${r.n} obs.)` : `Magnitude ${(r.mag as number).toFixed(2)}`}</p>
          <p className="text-muted">Band: {r.band}</p>
        </>
      )}
    </div>
  );
}
