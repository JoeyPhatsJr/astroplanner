/** Tiny altitude-vs-time line; 0–90° vertical, with the min-altitude limit drawn as a hairline. */
export function Sparkline({ values, minAlt, width = 120, height = 34 }: { values: number[]; minAlt: number; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => height - (Math.max(0, Math.min(90, v)) / 90) * height;
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      <line x1={0} x2={width} y1={y(minAlt)} y2={y(minAlt)} stroke="#e2b86a" strokeOpacity={0.5} strokeDasharray="2 3" />
      <line x1={0} x2={width} y1={height} y2={height} stroke="#29344d" />
      <path d={d} fill="none" stroke="#86d3e3" strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  );
}
