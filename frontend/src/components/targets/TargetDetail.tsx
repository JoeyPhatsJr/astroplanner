import { AlertTriangle, Check, ExternalLink, Plus, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useCurrentEquipment, useVisibility } from "../../api/hooks";
import { formatDec, formatDeg, formatRA, formatSize } from "../../lib/format";
import { formatDateTime, formatDuration, formatTime, tzAbbrev } from "../../lib/time";
import { useActiveSession } from "../../state/activeSession";
import { usePrefs } from "../../state/prefs";
import { AltitudeChart } from "../charts/LazyCharts";
import { SegmentedScoreBar, ScoreBreakdown } from "../tonight/ScoreHero";
import { ErrorState, Notice, Skeleton } from "../ui/States";
import { ScoreChip } from "./TargetCard";

export function TargetDetail({ targetId, onClose }: { targetId: string | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { prefs } = usePrefs();
  const q = useVisibility(targetId);
  const eq = useCurrentEquipment();
  const active = useActiveSession();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (targetId && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    } else if (!targetId && d.open) {
      d.close();
    }
  }, [targetId]);

  const data = q.data;
  const tz = data?.night.timezone ?? "UTC";
  const v = data?.visibility;
  const t = data?.target;
  const inSession = t ? active.inSession(t.id) : false;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="target-detail-title"
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-[640px] overflow-y-auto border-l border-line bg-night p-0 text-ink backdrop:bg-black/60 sm:w-[min(640px,92vw)]"
    >
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line-soft bg-night px-5 py-3.5">
        <h2 id="target-detail-title" className="min-w-0 flex-1 truncate font-semibold tracking-tight text-xl">
          {t ? t.name : "Target"}
        </h2>
        {t && (
          <button
            type="button"
            className={`btn ${inSession ? "btn-ghost text-ice" : "btn-primary"}`}
            disabled={inSession || active.isAdding || !v?.can_observe}
            onClick={() => active.addTarget(t.id, data?.score.forecast_window ?? v?.best_window ?? null)}
          >
            {inSession ? <Check className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            {inSession ? "In session" : "Add to session"}
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close details" autoFocus>
          <X className="size-5" aria-hidden />
        </button>
      </div>

      <div className="flex flex-col gap-5 p-5">
        {active.error && <Notice tone="warn">{active.error}</Notice>}
        {q.isLoading && (
          <>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-[240px] w-full" />
            <Skeleton className="h-32 w-full" />
          </>
        )}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {data && t && v && (
          <>
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <p className="text-sm text-ink-2">
                  {t.primary_designation} · {t.kind} in {t.constellation}
                </p>
                {t.aliases.length > 0 && <p className="mt-1 text-xs leading-relaxed text-muted">Also: {t.aliases.join(", ")}</p>}
              </div>
              <ScoreChip total={data.score.total} max={data.score.max_total} />
            </div>

            <div className={`rounded-lg border px-3.5 py-2.5 text-sm ${v.can_observe ? "border-ice/30 text-ink-2" : "border-warn/40 text-ink-2"}`}>
              <p className="font-semibold text-ink">{v.status_text}</p>
              {!v.can_observe && <p className="mt-0.5">{v.status_detail}</p>}
              {v.best_window && (
                <p className="mt-0.5">
                  Best window {formatTime(v.best_window.start_utc, tz)}–{formatTime(v.best_window.end_utc, tz)} {tzAbbrev(v.best_window.start_utc, tz)} (
                  {formatDuration(v.best_window.minutes)} above {v.min_altitude_deg}° in darkness)
                </p>
              )}
              {data.score.forecast_window && (
                <p className="mt-0.5 text-ice">
                  Forecast-favorable {formatTime(data.score.forecast_window.start_utc, tz)}–{formatTime(data.score.forecast_window.end_utc, tz)} (
                  {data.score.forecast_window.rule})
                </p>
              )}
            </div>

            <AltitudeChart data={data} minAlt={prefs.minAltitudeDeg} />

            <dl className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm sm:grid-cols-3">
              <Fact label="RA (J2000)" value={formatRA(t.ra_deg)} />
              <Fact label="Dec (J2000)" value={formatDec(t.dec_deg)} />
              <Fact label="Size (catalog)" value={formatSize(t.angular_major_arcmin, t.angular_minor_arcmin)} />
              <Fact label="Magnitude" value={t.magnitude !== null ? `${t.magnitude.toFixed(1)} (${t.magnitude_band})` : "Not listed"} />
              <Fact label="Peak in darkness" value={v.max_alt_dark_utc ? `${formatDeg(v.max_alt_dark_deg)} at ${formatTime(v.max_alt_dark_utc, tz)}` : "–"} />
              <Fact label="Culmination" value={`${formatDeg(v.culmination_alt_deg)} at ${formatTime(v.culmination_utc, tz)}`} />
              <Fact label="Rises (0°)" value={v.circumpolar ? "Circumpolar" : v.rise_utc ? formatDateTime(v.rise_utc, tz) : v.never_rises ? "Never" : "Not in span"} />
              <Fact label="Sets (0°)" value={v.circumpolar ? "Circumpolar" : v.set_utc ? formatDateTime(v.set_utc, tz) : v.never_rises ? "Never" : "Not in span"} />
              <Fact
                label={`Moon separation (${v.moon_separation_deg.basis})`}
                value={`${formatDeg(v.moon_separation_deg.min)} min · Moon up ${Math.round(v.moon_separation_deg.moon_up_fraction * 100)}%`}
              />
            </dl>
            <p className="text-xs leading-relaxed text-muted">
              Integrated magnitude is a total brightness, not an imaging-difficulty score: diffuse objects with low surface brightness can be harder than their magnitude suggests.
            </p>

            {data.score.components.length > 0 && (
              <section className="flex flex-col gap-3" aria-labelledby="ts-heading">
                <h3 id="ts-heading" className="font-semibold tracking-tight text-lg">
                  Why this score
                </h3>
                <SegmentedScoreBar components={data.score.components} height={10} />
                <ScoreBreakdown components={data.score.components} />
                <p className="text-xs text-muted">Heuristic recommendation score. Components shown with their data basis.</p>
              </section>
            )}

            {data.score.cautions.length > 0 && (
              <ul className="flex flex-col gap-1.5 text-sm text-warn/90">
                {data.score.cautions.map((c) => (
                  <li key={c} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {c}
                  </li>
                ))}
              </ul>
            )}
            {eq && (
              <p className="text-xs text-muted">
                Framing notes use {eq.name}
                {eq.fov_deg ? ` (~${eq.fov_deg}° field, ${eq.fov_definition === "unknown" ? "axis unverified" : eq.fov_definition})` : ""}. They are advisory and do not change the score.
              </p>
            )}

            <p className="text-xs text-muted">
              Coordinates and size from{" "}
              <a href={t.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ice hover:underline">
                OpenNGC ({t.source_id}) <ExternalLink className="size-3" aria-hidden />
              </a>
              , CC BY-SA 4.0. {t.emission_line_dominant ? "Marked emission-line dominant by the AstroPlanner curator (used only for Moon tolerance)." : ""}
            </p>
          </>
        )}
      </div>
    </dialog>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 tabular-nums text-ink">{value}</dd>
    </div>
  );
}
