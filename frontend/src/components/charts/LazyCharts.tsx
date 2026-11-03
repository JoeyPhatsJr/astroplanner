import { lazy, Suspense, type ComponentProps } from "react";

// Recharts is the largest dependency; load it only when a chart is actually rendered.
const NightTimelineImpl = lazy(() => import("./NightTimeline").then((m) => ({ default: m.NightTimeline })));
const AltitudeChartImpl = lazy(() => import("./AltitudeChart").then((m) => ({ default: m.AltitudeChart })));

const LightCurveImpl = lazy(() => import("../variables/LightCurve").then((m) => ({ default: m.LightCurve })));

function ChartPlaceholder({ label }: { label: string }) {
  return (
    <div role="status" className="flex h-64 items-center justify-center rounded-lg border border-line-soft text-sm text-muted md:h-72">
      Loading {label}…
    </div>
  );
}

export function NightTimeline(props: ComponentProps<typeof NightTimelineImpl>) {
  return (
    <Suspense fallback={<ChartPlaceholder label="night timeline" />}>
      <NightTimelineImpl {...props} />
    </Suspense>
  );
}

export function AltitudeChart(props: ComponentProps<typeof AltitudeChartImpl>) {
  return (
    <Suspense fallback={<ChartPlaceholder label="altitude chart" />}>
      <AltitudeChartImpl {...props} />
    </Suspense>
  );
}

export function LightCurve(props: ComponentProps<typeof LightCurveImpl>) {
  return (
    <Suspense fallback={<ChartPlaceholder label="light curve" />}>
      <LightCurveImpl {...props} />
    </Suspense>
  );
}
