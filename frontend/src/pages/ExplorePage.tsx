import { MapPin, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCurrentLocation, useRecommendations } from "../api/hooks";
import type { Category, Recommendation } from "../api/types";
import { Sparkline } from "../components/targets/Sparkline";
import { ScoreChip } from "../components/targets/TargetCard";
import { TargetDetail } from "../components/targets/TargetDetail";
import { TargetFilters } from "../components/targets/TargetFilters";
import { EmptyState, ErrorState, Notice, Skeleton } from "../components/ui/States";
import { formatDeg, formatSize } from "../lib/format";
import { formatTime } from "../lib/time";
import { usePrefs } from "../state/prefs";

const STATUS_TONE: Record<string, string> = {
  observable: "border-ice/40 text-ice",
  too_brief: "border-gold/40 text-gold",
  daylight_only: "border-line text-ink-2",
  below_threshold: "border-line text-muted",
  never_rises: "border-line text-muted",
  no_darkness: "border-line text-muted",
};

export function ExplorePage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(query);
  const [category, setCategory] = useState<Category>((params.get("type") as Category) || "all");
  const openId = params.get("target");
  const { prefs } = usePrefs();
  const { location, isLoading } = useCurrentLocation();
  const recs = useRecommendations({ category, query: debounced });

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debounced) next.set("q", debounced);
    else next.delete("q");
    if (category !== "all") next.set("type", category);
    else next.delete("type");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [debounced, category, params, setParams]);

  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("target", id);
    else next.delete("target");
    setParams(next);
  };

  if (!isLoading && !location)
    return (
      <EmptyState icon={<MapPin className="size-6" />} title="Add an observing location first" action={<Link to="/settings" className="btn btn-primary">Add a location</Link>}>
        Visibility is computed for your location and night.
      </EmptyState>
    );

  const tz = location?.timezone ?? "UTC";
  const results = recs.data?.results ?? [];

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
      <div>
        <h1 className="font-serif text-3xl tracking-tight md:text-[2.4rem]">Explore</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-2">
          {recs.data ? `${recs.data.observable_count} of ${results.length} matching targets` : "Targets"} are observable for the selected night above {prefs.minAltitudeDeg}°. Every target
          shows why it is or isn’t.
        </p>
      </div>

      <div className="panel flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[220px] flex-1">
          <label htmlFor="ex-search" className="label">
            Search by name, Messier/NGC/IC number or constellation
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              id="ex-search"
              type="search"
              className="field pl-8"
              placeholder="e.g. M42, Veil, NGC 7000, Cygnus"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <TargetFilters idPrefix="ex" category={category} onCategory={setCategory} />
      </div>

      {recs.data && recs.data.weather_status !== "ok" && <Notice tone="warn">Scores exclude weather: {recs.data.weather_message ?? "forecast unavailable"}</Notice>}
      {recs.isLoading && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      )}
      {recs.error && <ErrorState error={recs.error} onRetry={() => recs.refetch()} />}
      {recs.data && results.length === 0 && (
        <EmptyState icon={<Search className="size-6" />} title="No targets match">
          Nothing in the {recs.data ? "58-target" : ""} catalog matches “{debounced}”. Try a Messier number like M31 or a constellation name.
        </EmptyState>
      )}
      {results.length > 0 && (
        <ul className={`flex flex-col gap-2 ${recs.isFetching ? "opacity-70" : ""}`} aria-label="Targets">
          {results.map((r) => (
            <Row key={r.target.id} rec={r} tz={tz} minAlt={prefs.minAltitudeDeg} onOpen={() => setOpen(r.target.id)} />
          ))}
        </ul>
      )}
      <TargetDetail targetId={openId} onClose={() => setOpen(null)} />
    </div>
  );
}

function Row({ rec, tz, minAlt, onOpen }: { rec: Recommendation; tz: string; minAlt: number; onOpen: () => void }) {
  const { target: t, visibility: v, score } = rec;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="panel grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors hover:border-ice/40 md:grid-cols-[minmax(0,2fr)_minmax(0,2.2fr)_auto_auto]"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium text-ink">{t.name}</span>
          <span className="block truncate text-xs text-muted">
            {t.primary_designation} · {t.kind} · {t.constellation} · {formatSize(t.angular_major_arcmin, t.angular_minor_arcmin)}
          </span>
        </span>
        <span className="order-3 col-span-2 min-w-0 text-xs md:order-none md:col-span-1">
          <span className={`badge ${STATUS_TONE[v.status]}`}>{v.status_text}</span>
          <span className="ml-2 text-ink-2">
            {v.best_window
              ? `${formatTime(v.best_window.start_utc, tz)}–${formatTime(v.best_window.end_utc, tz)}, peak ${formatDeg(v.max_alt_dark_deg)}`
              : v.status_detail}
          </span>
        </span>
        <span className="hidden md:block">
          <Sparkline values={rec.sparkline_alt_deg} minAlt={minAlt} width={100} height={28} />
        </span>
        <span className="w-14 text-right">
          {score.total !== null ? <ScoreChip total={score.total} max={score.max_total} /> : <span className="text-xs text-muted">–</span>}
        </span>
      </button>
    </li>
  );
}
