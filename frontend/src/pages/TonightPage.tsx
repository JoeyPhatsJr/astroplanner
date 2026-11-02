import { MapPin, MoonStar, Telescope } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useCurrentLocation, useNightDate, useRecommendations, useTonight } from "../api/hooks";
import type { Category } from "../api/types";
import { NightTimeline } from "../components/charts/LazyCharts";
import { SessionPlanPanel } from "../components/session/SessionPlanPanel";
import { TargetCard } from "../components/targets/TargetCard";
import { TargetDetail } from "../components/targets/TargetDetail";
import { TargetFilters } from "../components/targets/TargetFilters";
import { ConditionTiles, ForecastMeta } from "../components/tonight/Conditions";
import { ScoreHero } from "../components/tonight/ScoreHero";
import { EmptyState, ErrorState, Notice, Skeleton } from "../components/ui/States";
import { formatLatLon } from "../lib/format";
import { nightLabel } from "../lib/time";
import { useActiveSession } from "../state/activeSession";
import { usePrefs } from "../state/prefs";

const TOP_N = 9;

export function TonightPage() {
  const { prefs, update } = usePrefs();
  const { location, isLoading: locLoading, error: locError, refetch } = useCurrentLocation();
  const tonight = useTonight();
  const { nightDate } = useNightDate();
  const [category, setCategory] = useState<Category>("all");
  const [observableOnly, setObservableOnly] = useState(true);
  const recs = useRecommendations({ category });
  const [openId, setOpenId] = useState<string | null>(null);
  const active = useActiveSession();

  if (locLoading) return <PageSkeleton />;
  if (locError) return <ErrorState error={locError} onRetry={refetch} title="Couldn't load your locations" />;
  if (!location)
    return (
      <EmptyState icon={<MapPin className="size-6" />} title="Add an observing location" action={<Link to="/settings" className="btn btn-primary">Add a location</Link>}>
        Everything on this page is computed for a specific place and time. Search for a city or enter coordinates in Settings.
      </EmptyState>
    );

  const tz = location.timezone;
  const data = tonight.data;
  const results = recs.data?.results ?? [];
  const shown = (observableOnly ? results.filter((r) => r.visibility.can_observe) : results).slice(0, TOP_N);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-semibold tracking-tight text-3xl  text-ink md:text-[2.4rem]">Tonight</h1>
          <p className="mt-1 text-sm text-ink-2">
            {nightDate ? nightLabel(nightDate) : ""} at {location.label}
            <span className="text-muted"> · {formatLatLon(location.latitude_deg, location.longitude_deg)} · {tz}</span>
          </p>
        </div>
        {location.is_sample && (
          <Notice>
            You are viewing the editable sample location.{" "}
            <Link to="/settings" className="text-ice hover:underline">
              Set your own location
            </Link>
            .
          </Notice>
        )}
      </div>

      {tonight.isLoading && <PageSkeleton />}
      {tonight.error && <ErrorState error={tonight.error} onRetry={() => tonight.refetch()} title="Couldn't compute tonight" />}

      {data && (
        <>
          {!data.night.has_darkness && (
            <Notice tone="warn">
              <span className="font-semibold text-ink">No {data.night.darkness} darkness this night. </span>
              {data.night.notes.join(" ")}{" "}
              {prefs.darkness === "astronomical" && data.night.sun_min_alt_deg < -12 && (
                <button type="button" className="ml-1 text-ice underline-offset-2 hover:underline" onClick={() => update({ darkness: "nautical" })}>
                  Use nautical darkness (Sun below −12°) instead
                </button>
              )}
            </Notice>
          )}
          {prefs.darkness === "nautical" && (
            <Notice>
              Darkness is set to nautical (Sun below −12°): brighter skies than astronomical night.{" "}
              <button type="button" className="text-ice hover:underline" onClick={() => update({ darkness: "astronomical" })}>
                Switch back to astronomical
              </button>
            </Notice>
          )}

          <div className={`grid grid-cols-1 gap-5 lg:grid-cols-[minmax(320px,400px)_1fr] ${tonight.isFetching ? "opacity-70" : ""}`}>
            <ScoreHero score={data.score} tz={tz} />
            <div className="flex min-w-0 flex-col gap-4">
              <ConditionTiles night={data.night} forecast={data.forecast} />
              <section className="panel flex min-w-0 flex-col gap-3 p-4 md:p-5" aria-labelledby="timeline-heading">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id="timeline-heading" className="font-semibold tracking-tight text-xl">
                    Dusk to dawn
                  </h2>
                  <ForecastMetaInline />
                </div>
                <NightTimeline night={data.night} forecast={data.forecast} />
                <ForecastMeta forecast={data.forecast} tz={tz} />
              </section>
            </div>
          </div>
        </>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
        <section className="flex min-w-0 flex-col gap-4" aria-labelledby="targets-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="targets-heading" className="font-semibold tracking-tight text-2xl">
                Best targets tonight
              </h2>
              {recs.data && (
                <p className="text-sm text-muted">
                  {recs.data.observable_count} of {results.length} catalog targets clear {prefs.minAltitudeDeg}° during darkness. Ranked by a heuristic recommendation score.
                </p>
              )}
            </div>
            <TargetFilters idPrefix="tn" category={category} onCategory={setCategory} observableOnly={observableOnly} onObservableOnly={setObservableOnly} />
          </div>
          {active.error && <Notice tone="warn">{active.error}</Notice>}
          {recs.isLoading && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-60" />
              ))}
            </div>
          )}
          {recs.error && <ErrorState error={recs.error} onRetry={() => recs.refetch()} />}
          {recs.data && recs.data.weather_status !== "ok" && (
            <Notice tone="warn">Scores below exclude weather: {recs.data.weather_message ?? "forecast unavailable"}</Notice>
          )}
          {recs.data && shown.length === 0 && (
            <EmptyState icon={<MoonStar className="size-6" />} title={recs.data.has_darkness ? "No targets meet your limits" : "No darkness, so no targets"}>
              {recs.data.has_darkness
                ? `No ${category === "all" ? "catalog targets" : category + "s"} stay above ${prefs.minAltitudeDeg}° for at least 30 minutes of darkness. Try a lower minimum altitude or another type.`
                : "Targets are only recommended when they are above your altitude limit during darkness."}
            </EmptyState>
          )}
          {shown.length > 0 && (
            <div className={`grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3 ${recs.isFetching ? "opacity-70" : ""}`}>
              {shown.map((r) => (
                <TargetCard
                  key={r.target.id}
                  rec={r}
                  tz={tz}
                  minAlt={prefs.minAltitudeDeg}
                  onOpen={() => setOpenId(r.target.id)}
                  onAdd={() => active.addTarget(r.target.id, r.score.forecast_window ?? r.visibility.best_window)}
                  inSession={active.inSession(r.target.id)}
                  adding={active.isAdding}
                />
              ))}
            </div>
          )}
          {recs.data && (
            <Link to="/explore" className="inline-flex items-center gap-2 self-start text-sm text-ice hover:underline">
              <Telescope className="size-4" aria-hidden /> Browse all {results.length} targets in Explore
            </Link>
          )}
        </section>
        <aside className="xl:sticky xl:top-20 xl:self-start">
          <SessionPlanPanel />
        </aside>
      </div>

      <TargetDetail targetId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function ForecastMetaInline() {
  return <span className="text-xs text-muted">Hover the chart for exact values</span>;
}

function PageSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(320px,400px)_1fr]">
      <Skeleton className="h-[420px]" label="Loading score" />
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-[300px]" label="Loading timeline" />
      </div>
    </div>
  );
}
