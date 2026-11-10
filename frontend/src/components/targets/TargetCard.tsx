import { AlertTriangle, Check, Plus } from "lucide-react";
import type { Recommendation } from "../../api/types";
import { formatDuration, formatTime, tzAbbrev } from "../../lib/time";
import { HistoryBadge } from "../astrolog/HistoryBadge";
import { SkyThumb } from "./SkyThumb";
import { Sparkline } from "./Sparkline";

export function ScoreChip({
  total,
  max,
}: {
  total: number | null;
  max: number | null;
}) {
  if (total === null || max === null) return null;
  return (
    <div className="text-right">
      <p className="font-semibold tracking-tight text-2xl leading-none text-ink">
        {Math.round(total)}
        <span className="font-sans text-xs text-muted">/{max}</span>
      </p>
      {max < 100 && (
        <p className="mt-0.5 text-micro text-warn">weather excluded</p>
      )}
    </div>
  );
}

export function TargetCard({
  rec,
  tz,
  minAlt,
  fovDeg = null,
  onOpen,
  onAdd,
  inSession,
  adding,
}: {
  rec: Recommendation;
  tz: string;
  minAlt: number;
  fovDeg?: number | null;
  onOpen: () => void;
  onAdd: () => void;
  inSession: boolean;
  adding: boolean;
}) {
  const { target: t, visibility: v, score } = rec;
  const w = v.best_window;
  const clear = score.forecast_window?.minutes ?? null;
  const up = v.observable_minutes ?? null;
  const showDesignation =
    t.primary_designation && t.primary_designation !== t.name;
  const sub = [
    showDesignation ? t.primary_designation : null,
    t.kind,
    t.constellation,
  ]
    .filter(Boolean)
    .join(" · ");
  const caution = score.cautions[0];
  return (
    <article
      className={`panel relative flex min-w-0 gap-3 p-3 transition-transform duration-[120ms] ease-[var(--ease-out)] has-[.card-open:active]:scale-[0.97] motion-reduce:has-[.card-open:active]:scale-100 ${inSession ? "border-ice/50" : ""}`}
    >
      <SkyThumb target={t} fovDeg={fovDeg} size={112} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex justify-between gap-2">
          <h3 className="min-w-0 font-semibold tracking-tight text-base leading-tight text-ink">
            <button
              type="button"
              onClick={onOpen}
              className="card-open text-left after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ice"
            >
              {t.name}
            </button>
          </h3>
          <ScoreChip total={score.total} max={score.max_total} />
        </div>
        <p className="mt-0.5 truncate text-label text-muted">{sub}</p>
        <p className="mt-1.5 text-sm font-medium text-ink">
          {w ? (
            <>
              {formatTime(w.start_utc, tz)}–{formatTime(w.end_utc, tz)}{" "}
              <span className="font-normal text-muted">
                {tzAbbrev(w.start_utc, tz)}
              </span>
            </>
          ) : (
            <span className="font-normal text-muted">{v.status_text}</span>
          )}
        </p>
        {clear != null ? (
          <p className="text-label font-medium text-ice">
            {formatDuration(clear)} clear
            {up != null && up - clear > 1 && (
              <span className="ml-1 font-normal text-muted">
                of {formatDuration(up)} up
              </span>
            )}
          </p>
        ) : up != null && up > 0 ? (
          <p className="text-label text-muted">{formatDuration(up)} up</p>
        ) : null}
        {caution && (
          <p className="mt-1 flex gap-1.5 text-label leading-snug text-warn/90">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {caution}
          </p>
        )}
        <div className="mt-auto flex items-center gap-2 pt-1.5">
          <Sparkline
            values={rec.sparkline_alt_deg}
            minAlt={minAlt}
            width={62}
            height={18}
          />
          <HistoryBadge catalogId={t.id} className="relative z-10" />
          <button
            type="button"
            className={`btn btn-icon press relative z-10 ml-auto size-11 flex-none ${inSession ? "btn-ghost text-ice" : "btn-primary"}`}
            onClick={onAdd}
            disabled={inSession || adding || !v.can_observe}
            aria-label={
              inSession
                ? `${t.name} is in your session`
                : `Add ${t.name} to session`
            }
          >
            {inSession ? (
              <Check className="size-4" aria-hidden />
            ) : (
              <Plus className="size-4" aria-hidden />
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
