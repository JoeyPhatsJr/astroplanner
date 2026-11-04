import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReportBin } from "../../api/processing";
import { useThemeColors } from "../../lib/theme";

interface Row {
  label: string;
  kept: number;
  dropped: number;
  notAligned: number;
}

/** Stacked bars per time bin. Rows are derived from the report; `kept: null` bins have no kept/dropped split. */
export function framesRows(bins: ReportBin[]): Row[] {
  return bins.map((b) => ({
    label: b.label_local,
    kept: b.kept ?? 0,
    dropped: b.kept === null ? b.aligned : b.aligned - b.kept,
    notAligned: b.captured - b.aligned,
  }));
}

export function FramesChart({ bins, summary }: { bins: ReportBin[]; summary: string }) {
  const c = useThemeColors();
  const rows = framesRows(bins);
  const keptKnown = bins.every((b) => b.kept !== null);
  return (
    <div role="img" aria-label={summary} className="h-[200px] w-full md:h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -18 }} barCategoryGap={2}>
          <CartesianGrid stroke={c.line} strokeOpacity={0.6} vertical={false} />
          <XAxis dataKey="label" stroke={c.muted} tick={{ fontSize: 10 }} tickLine={false} axisLine={{ stroke: c.line }} interval="preserveStartEnd" minTickGap={24} />
          <YAxis stroke={c.muted} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: c.panel2 }}
            contentStyle={{ background: c.panel2, border: `1px solid ${c.line}`, fontSize: 12 }}
            labelStyle={{ color: c.ink }}
          />
          {keptKnown && <Bar dataKey="kept" name="In your stack" stackId="f" fill={c.accent} isAnimationActive={false} />}
          <Bar dataKey="dropped" name={keptKnown ? "Aligned, dropped" : "Aligned"} stackId="f" fill={keptKnown ? c.warn : c.accentDim} isAnimationActive={false} />
          <Bar dataKey="notAligned" name="Siril couldn't align" stackId="f" fill={c.line} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
