import type { ScoreComponent, TonightScore } from "../../api/types";
import { formatPoints } from "../../lib/format";
import { formatTime, tzAbbrev } from "../../lib/time";
import { BasisBadge } from "../ui/States";

const SEGMENT_COLORS: Record<string, string> = {
  cloud: "#86d3e3",
  precipitation: "#5aa6bb",
  moon: "#c9d3e3",
  darkness: "#7486ad",
  altitude: "#86d3e3",
  duration: "#5aa6bb",
  weather: "#7486ad",
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
              background: c.points === null ? "repeating-linear-gradient(135deg,#1b2538 0 5px,#141c2d 5px 10px)" : "#1f2a40",
            }}
          >
            <div className="absolute inset-y-0 left-0" style={{ width: `${frac * 100}%`, background: SEGMENT_COLORS[c.key] ?? "#86d3e3" }} />
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
            <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: SEGMENT_COLORS[c.key] ?? "#86d3e3" }} aria-hidden />
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

export function ScoreHero({ score, tz }: { score: TonightScore; tz: string }) {
  const hasTotal = score.total !== null;
  const sum = score.components.reduce((s, c) => s + (c.points ?? 0), 0);
  return (
    <section className="panel flex flex-col gap-5 p-5 md:p-6 lg:self-start" aria-labelledby="score-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="score-heading" className="font-serif text-xl text-ink">
          Tonight’s Score
        </h2>
        <span className="text-xs text-muted">Heuristic planning estimate</span>
      </div>

      <div className="flex items-end gap-4">
        {hasTotal ? (
          <p className="font-serif text-[4.5rem] leading-[0.85] tracking-tight text-ink" data-testid="score-total">
            {Math.round(score.total!)}
            <span className="ml-1.5 align-top font-sans text-base font-medium text-muted">/ 100</span>
          </p>
        ) : (
          <div data-testid="score-no-total">
            <p className="font-serif text-4xl leading-none text-ink-2">No score</p>
            <p className="mt-2 max-w-sm text-sm text-muted">
              {score.status === "no_weather"
                ? "Without a forecast there is no weather-backed total."
                : "There is no darkness on this night to score."}
              {score.partial_total !== undefined && (
                <>
                  {" "}
                  Calculated parts only: <span className="text-ink-2">{formatPoints(score.partial_total)}</span> of{" "}
                  {score.partial_max}.
                </>
              )}
            </p>
          </div>
        )}
        {score.window && (
          <p className="mb-1 ml-auto text-right text-sm text-ink-2">
            <span className="block text-xs text-muted">Best 2-hour window</span>
            {formatTime(score.window.start_utc, tz)}–{formatTime(score.window.end_utc, tz)} {tzAbbrev(score.window.start_utc, tz)}
          </p>
        )}
      </div>

      <SegmentedScoreBar components={score.components} />
      <ScoreBreakdown components={score.components} />

      {hasTotal && (
        <p className="text-xs text-muted">
          Components sum to {formatPoints(sum)}
          {score.status === "partial_weather" ? ". Some dark hours had no forecast values and were skipped." : "."}
        </p>
      )}

      <details className="group text-sm text-ink-2">
        <summary className="cursor-pointer select-none text-ice hover:underline">How this score is calculated</summary>
        <p className="mt-2 leading-relaxed">{score.method}</p>
        <p className="mt-2 leading-relaxed text-muted">{score.disclaimer}</p>
      </details>
    </section>
  );
}
