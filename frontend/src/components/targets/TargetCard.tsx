import { AlertTriangle, Check, Plus } from "lucide-react";
import type { Recommendation } from "../../api/types";
import { formatDeg } from "../../lib/format";
import { formatTime, tzAbbrev } from "../../lib/time";
import { Sparkline } from "./Sparkline";

export function ScoreChip({ total, max }: { total: number | null; max: number | null }) {
  if (total === null || max === null) return null;
  return (
    <div className="text-right">
      <p className="font-serif text-2xl leading-none text-ink">
        {Math.round(total)}
        <span className="font-sans text-xs text-muted">/{max}</span>
      </p>
      {max < 100 && <p className="mt-0.5 text-[0.68rem] text-warn">weather excluded</p>}
    </div>
  );
}

export function TargetCard({
  rec,
  tz,
  minAlt,
  onOpen,
  onAdd,
  inSession,
  adding,
}: {
  rec: Recommendation;
  tz: string;
  minAlt: number;
  onOpen: () => void;
  onAdd: () => void;
  inSession: boolean;
  adding: boolean;
}) {
  const { target: t, visibility: v, score } = rec;
  const w = v.best_window;
  return (
    <article className={`panel flex flex-col gap-3 p-4 ${inSession ? "border-gold/50" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-serif text-lg leading-tight text-ink">
            <button type="button" onClick={onOpen} className="text-left hover:text-ice focus-visible:text-ice">
              {t.name}
            </button>
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            {t.primary_designation} · {t.kind} · {t.constellation}
          </p>
        </div>
        <ScoreChip total={score.total} max={score.max_total} />
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="text-sm">
          {w ? (
            <p className="text-ink-2">
              {formatTime(w.start_utc, tz)}–{formatTime(w.end_utc, tz)} <span className="text-muted">{tzAbbrev(w.start_utc, tz)}</span>
            </p>
          ) : (
            <p className="text-muted">{v.status_text}</p>
          )}
          <p className="text-xs text-muted">Peak in darkness {formatDeg(v.max_alt_dark_deg)}</p>
        </div>
        <Sparkline values={rec.sparkline_alt_deg} minAlt={minAlt} />
      </div>

      {score.why.length > 0 && (
        <ul className="flex flex-col gap-1 text-[0.8rem] leading-snug text-ink-2">
          {score.why.slice(0, 3).map((x) => (
            <li key={x} className="flex gap-2">
              <span className="mt-[0.45rem] size-1 shrink-0 rounded-full bg-ice" aria-hidden />
              {x}
            </li>
          ))}
        </ul>
      )}
      {score.cautions.length > 0 && (
        <ul className="flex flex-col gap-1 text-[0.78rem] leading-snug text-warn/90">
          {score.cautions.slice(0, 2).map((x) => (
            <li key={x} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {x}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex gap-2 pt-1">
        <button type="button" className="btn flex-1" onClick={onOpen}>
          Details
        </button>
        <button
          type="button"
          className={`btn flex-1 ${inSession ? "btn-ghost text-gold" : "btn-primary"}`}
          onClick={onAdd}
          disabled={inSession || adding || !v.can_observe}
          aria-label={inSession ? `${t.name} is in your session` : `Add ${t.name} to session`}
        >
          {inSession ? <Check className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
          {inSession ? "In session" : "Add to session"}
        </button>
      </div>
    </article>
  );
}
