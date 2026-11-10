import { MapPin, MoonStar, Telescope } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useCurrentEquipment, useCurrentLocation, useNightDate, useRecommendations, useTonight } from "../api/hooks";
import type { Category, TonightResponse } from "../api/types";
import { SessionPlanPanel } from "../components/session/SessionPlanPanel";
import { TargetCard } from "../components/targets/TargetCard";
import { TargetDetail } from "../components/targets/TargetDetail";
import { TargetFilters } from "../components/targets/TargetFilters";
import { FactsRow, ForecastMeta } from "../components/tonight/Conditions";
import { NightStrip } from "../components/tonight/NightStrip";
import { ScoreHero } from "../components/tonight/ScoreHero";
import { EmptyState, ErrorState, Notice, Skeleton } from "../components/ui/States";
import { formatLatLon } from "../lib/format";
import { darkForecastGaps, nightHeadline } from "../lib/nightHeadline";
import { nightLabel, nightPageTitle, tzAbbrev } from "../lib/time";
import { useActiveSession } from "../state/activeSession";
import { usePrefs } from "../state/prefs";
import { PageHeader } from "../components/ui/PageHeader";

const TOP_N = 9;

export function TonightPage() {
  const { prefs, update } = usePrefs();
  const { location, isLoading: locLoading, error: locError, refetch } = useCurrentLocation();
  const tonight = useTonight();
  const { nightDate, isAuto } = useNightDate();
  const [category, setCategory] = useState<Category>("all");
  const [observableOnly, setObservableOnly] = useState(true);
  const recs = useRecommendations({ category });
  const [openId, setOpenId] = useState<string | null>(null);
  const active = useActiveSession();
  const equipment = useCurrentEquipment();

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

  // A reason that holds for every card shown (for example "Moon stays below the horizon") is said once.
  const shared = shown.length > 1 ? shown[0].score.why.filter((x) => shown.every((r) => r.score.why.includes(x))) : [];

  return (
    <div className="page-wide flex flex-col gap-6">
      <PageHeader
        title={nightPageTitle(nightDate, isAuto)}
        subtitle={
          <>
            {nightDate ? nightLabel(nightDate) : ""} at {location.label}
            <span className="text-muted"> · {formatLatLon(location.latitude_deg, location.longitude_deg)} · {tz}</span>
          </>
        }
        actions={
          location.is_sample ? (
            <Notice>
              You are viewing the editable sample location.{" "}
              <Link to="/settings" className="text-ice hover:underline">
                Set your own location
              </Link>
              .
            </Notice>
          ) : undefined
        }
      />

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

          <TonightPanels data={data} tz={tz} fetching={tonight.isFetching} />
        </>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
        <section className="flex min-w-0 flex-col gap-4" aria-labelledby="targets-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="targets-heading" className="font-semibold text-2xl">
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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-36" />
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
            <>
            {shared.length > 0 && <p className="text-sm text-ink-2">For every target below: {shared.join("; ")}.</p>}
            <div className={`grid grid-cols-1 gap-3 md:grid-cols-2 ${recs.isFetching ? "opacity-70" : ""}`}>
              {shown.map((r) => (
                <TargetCard
                  key={r.target.id}
                  rec={r}
                  tz={tz}
                  minAlt={prefs.minAltitudeDeg}
                  fovDeg={equipment?.fov_deg ?? null}
                  onOpen={() => setOpenId(r.target.id)}
                  onAdd={() => active.addTarget(r.target.id, r.score.forecast_window ?? r.visibility.best_window)}
                  inSession={active.inSession(r.target.id)}
                  adding={active.isAdding}
                />
              ))}
            </div>
            {shown.some((r) => r.target.sky_field_arcmin != null) && (
              <p className="text-label text-muted">
                Sky images: Digitized Sky Survey, red plates, scaled to each object with the width marked on the picture. © AURA and the plate copyright holders; used for non-profit purposes.
              </p>
            )}
            </>
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

      <TargetDetail targetId={openId} onClose={() => setOpenId(null)} onReopen={setOpenId} />
    </div>
  );
}

function TonightPanels({ data, tz, fetching }: { data: TonightResponse; tz: string; fetching: boolean }) {
  const { night, forecast, score } = data;
  const hasForecast = forecast.status === "ok";
  const dark = night.dark_intervals;
  const gaps = darkForecastGaps(night, forecast.hourly, data.night_clear);
  const headline = nightHeadline({
    clear: data.night_clear,
    darkMinutes: night.dark_minutes,
    darkStartUtc: dark.length ? dark[0].start_utc : null,
    darkEndUtc: dark.length ? dark[dark.length - 1].end_utc : null,
    hasDarkness: night.has_darkness,
    darkness: score.darkness,
    hasForecast,
    scoreStatus: score.status,
    missingDarkMinutes: gaps.missingDarkMinutes,
    clearEndsAtMissing: gaps.clearEndsAtMissing,
    forecastMessage: forecast.status === "ok" ? null : forecast.message,
    tz,
  });
  const stripTip = `${hasForecast ? "Each block is one forecast hour. Solid means overcast. " : ""}Thin band is the Moon above the horizon. Hours are ${tzAbbrev(night.display_start_utc, tz)}.`;
  return (
    <div className={`grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(280px,360px)_1fr] ${fetching ? "opacity-70" : ""}`}>
      <ScoreHero score={score} tz={tz} headline={headline} />
      <section className="panel flex min-w-0 flex-col gap-4 p-4 md:p-5" aria-label="Night from dusk to dawn">
        <NightStrip night={night} forecast={forecast} clear={data.night_clear} bestWindow={score.total !== null ? score.window : null} tz={tz} />
        <FactsRow night={night} forecast={forecast} />
        <p className="text-label text-muted">{stripTip}</p>
        <ForecastMeta forecast={forecast} tz={tz} />
      </section>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(280px,360px)_1fr]">
      <Skeleton className="h-[300px]" label="Loading score" />
      <Skeleton className="h-[340px]" label="Loading night" />
    </div>
  );
}
