import { useMemo } from "react";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import type { CurveResponse } from "../../api/variables";
import { useThemeColors } from "../../lib/theme";

const UNIX_JD_EPOCH = 2440587.5;
const DAY_MS = 86_400_000;
const jdToMs = (jd: number) => (jd - UNIX_JD_EPOCH) * DAY_MS;
const PAD = 0.3;
const round1 = (x: number) => Math.round(x * 10) / 10;

/** [brightest, faintest] magnitude bounds with padding; the axis is drawn reversed so brighter is up. */
export function curveYDomain(mags: number[]): [number, number] {
  if (mags.length === 0) return [8, 14];
  return [round1(Math.min(...mags) - PAD), round1(Math.max(...mags) + PAD)];
}

interface Row {
  t: number;
  mag: number;
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
  const daily = useMemo<Row[]>(
    () => curve.daily.map(([d, mag, n]) => ({ t: Date.parse(`${d}T12:00:00Z`), mag, band: "V + Vis.", kind: "daily", n })),
    [curve.daily],
  );
  const tMin = useMemo(() => Math.min(...[...v, ...vis, ...daily].map((r) => r.t)), [v, vis, daily]);
  const tMax = useMemo(() => Math.max(...[...v, ...vis, ...daily].map((r) => r.t)), [v, vis, daily]);
  // A night belongs to the evening's date; its middle is about the next UT midnight for a western observer.
  const nightMarks = useMemo<Row[]>(
    () =>
      nights
        .map((d) => Date.parse(`${d}T00:00:00Z`) + DAY_MS)
        .filter((t) => t >= tMin - DAY_MS && t <= tMax + DAY_MS)
        .map((t) => ({ t, mag: domain[1], band: "Your night", kind: "night" })),
    [nights, tMin, tMax, domain],
  );
  const longSpan = tMax - tMin > 200 * DAY_MS;
  const fmtTick = (t: number) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short", ...(longSpan ? { year: "2-digit" } : { day: "numeric" }) }).format(new Date(t));

  return (
    <figure aria-label={`Light curve for ${curve.window.label}. Brighter is up: the magnitude axis runs from fainter at the bottom to brighter at the top.`}>
      <div className="h-[280px] w-full md:h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={c.line} strokeOpacity={0.45} vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={[tMin, tMax]} tickFormatter={fmtTick} stroke={c.muted} tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: c.line }} />
            <YAxis
              dataKey="mag"
              type="number"
              reversed
              domain={domain}
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
            <Line name="Daily average" data={daily} dataKey="mag" type="monotone" stroke={c.accent} strokeWidth={2} dot={false} isAnimationActive={false} />
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
          <p className="text-ice">{r.kind === "daily" ? `Daily average ${r.mag.toFixed(2)} (${r.n} obs.)` : `Magnitude ${r.mag.toFixed(2)}`}</p>
          <p className="text-muted">Band: {r.band}</p>
        </>
      )}
    </div>
  );
}
