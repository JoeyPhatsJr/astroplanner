import { ChevronDown } from "lucide-react";
import type { ScoreComponent, TonightScore } from "../../api/types";
import { formatPoints } from "../../lib/format";
import { formatDuration, formatTime, tzAbbrev } from "../../lib/time";
import { BasisBadge } from "../ui/States";

const SEGMENT_COLORS: Record<string, string> = {
  cloud: "var(--color-seg-1)",
  precipitation: "var(--color-seg-2)",
  moon: "var(--color-seg-3)",
  darkness: "var(--color-seg-4)",
  altitude: "var(--color-seg-1)",
  duration: "var(--color-seg-2)",
  weather: "var(--color-seg-4)",
};

/** One bar for the whole 0–100 scale; each component owns a slice as wide as its maximum, filled by its points. */
export function SegmentedScoreBar({ components, height = 14 }: { components: ScoreComponent[]; height?: number }) {
  const totalMax = components.reduce((s, c) => s + c.max, 0) || 1;
  return (
    <div className="flex w-full gap-[3px]" style={{ height }} aria-hidden>
      {components.map((c) => {
        const frac = c.points === null ? 0 : Math.max(0, Math.min(1, c.points / c.max));
        return (
          <div
            key={c.key}
            className="relative overflow-hidden rounded-[3px]"
            style={{
              width: `${(c.max / totalMax) * 100}%`,
              background: c.points === null ? "repeating-linear-gradient(135deg,var(--color-panel-2) 0 5px,var(--color-night-deep) 5px 10px)" : "var(--color-line-soft)",
            }}
          >
            <div className="absolute inset-y-0 left-0" style={{ width: `${frac * 100}%`, background: SEGMENT_COLORS[c.key] ?? "var(--color-ice)" }} />
          </div>
        );
      })}
    </div>
  );
}

export function ScoreBreakdown({ components }: { components: ScoreComponent[] }) {
  return (
    <ul className="divide-y divide-line-soft" aria-label="Score components">
      {components.map((c) => (
        <li key={c.key} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
          <div className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: SEGMENT_COLORS[c.key] ?? "var(--color-ice)" }} aria-hidden />
            <span className="text-sm font-semibold text-ink">{c.label}</span>
            <BasisBadge basis={c.basis} />
            <span className="ml-auto text-sm tabular-nums text-ink">
              {c.points === null ? <span className="text-muted">not scored</span> : formatPoints(c.points)}
              <span className="text-muted"> / {c.max}</span>
            </span>
          </div>
          <p className="pl-[18px] text-[0.8rem] leading-snug text-muted">{c.detail}</p>
        </li>
      ))}
    </ul>
  );
}

export function ScoreHero({ score, tz, headline }: { score: TonightScore; tz: string; headline?: { title: string; detail: string } }) {
  const hasTotal = score.total !== null;
  const sum = score.components.reduce((s, c) => s + (c.points ?? 0), 0);
  const win = score.window ? `${formatTime(score.window.start_utc, tz)}–${formatTime(score.window.end_utc, tz)} ${tzAbbrev(score.window.start_utc, tz)}` : null;
  return (
    <section className="panel flex flex-col gap-4 p-5 md:p-6" aria-labelledby="score-heading">
      <h2 id="score-heading" className="sr-only">
        Tonight’s Score
      </h2>

      {hasTotal ? (
        <div>
          <p className="text-[4.5rem] font-semibold leading-[0.9] tracking-[-0.03em] text-ink tabular-nums" data-testid="score-total">
            {Math.round(score.total!)}
            <span className="ml-1.5 align-top font-sans text-base font-medium tracking-normal text-muted"> / 100</span>
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
            <span>
              for the best {score.window ? formatDuration(score.window.minutes) : "window"}{win ? `, ${win}` : ""}
            </span>
            <BasisBadge basis="heuristic" />
          </p>
        </div>
      ) : (
        <div data-testid="score-no-total">
          <p className="text-4xl font-semibold leading-none tracking-tight text-ink-2">No score</p>
          <p className="mt-2 max-w-sm text-sm text-muted">
            {score.status === "no_weather" ? "Without a forecast there is no weather-backed total." : "There is no darkness on this night to score."}
            {score.partial_total !== undefined && (
              <>
                {" "}
                Calculated parts only: <span className="text-ink-2">{formatPoints(score.partial_total)}</span> of {score.partial_max}.
              </>
            )}{" "}
            <BasisBadge basis="heuristic" />
          </p>
        </div>
      )}

      {headline && (
        <p className="text-sm leading-relaxed text-ink-2">
          <b className="block text-base font-semibold text-ink">{headline.title}</b>
          {headline.detail}
        </p>
      )}

      <details className="group text-sm text-ink-2">
        <summary className="disclosure-summary press min-h-11 w-fit cursor-pointer select-none py-2.5 text-ice hover:underline">
          Why this score
          <ChevronDown className="disclosure-chevron size-4" aria-hidden />
        </summary>
        <div className="flex flex-col gap-4 pt-2">
          <SegmentedScoreBar components={score.components} />
          <ScoreBreakdown components={score.components} />
          {hasTotal && (
            <p className="text-label text-muted">
              Components sum to {formatPoints(sum)}
              {score.status === "partial_weather" ? ". Some dark hours had no forecast values and were skipped." : "."}
            </p>
          )}
          <div>
            <p className="font-semibold text-ink">How this score is calculated</p>
            <p className="mt-1 leading-relaxed">{score.method}</p>
            <p className="mt-2 leading-relaxed text-muted">{score.disclaimer}</p>
          </div>
        </div>
      </details>
    </section>
  );
}
