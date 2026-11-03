import { useState } from "react";
import { isFixtureMode, shownAttribution, useStarCurve } from "../../api/variables";
import { formatAge } from "../../lib/time";
import { LightCurve } from "../charts/LazyCharts";
import { ErrorState, Notice, Skeleton } from "../ui/States";
import { FixtureNotice } from "./FixtureNotice";

/** Extra fixed history windows by star (keys match backend `history_windows`). */
const EXTRA_WINDOWS: Record<string, { key: string; label: string }[]> = {
  "t-crb": [{ key: "1946", label: "1946 eruption" }],
};

function ordinal(n: number): string {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}

export function LightCurveSection({ slug, nights }: { slug: string; nights: string[] }) {
  const extras = EXTRA_WINDOWS[slug] ?? [];
  const tabs = [{ key: "recent", label: "Last year" }, ...extras];
  const [win, setWin] = useState("recent");
  return (
    <section className="panel flex flex-col gap-3 p-4 md:p-5" aria-labelledby="vh-curve">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="vh-curve" className="font-semibold tracking-tight text-xl">
          Light curve
        </h2>
        {extras.length > 0 && (
          <div className="flex gap-1.5" role="group" aria-label="Light curve window">
            {tabs.map((t) => (
              <button key={t.key} type="button" aria-pressed={win === t.key} className={`btn ${win === t.key ? "btn-primary" : "btn-ghost"}`} onClick={() => setWin(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <CurveBody slug={slug} window={win} nights={win === "recent" ? nights : []} />
    </section>
  );
}

function CurveBody({ slug, window, nights }: { slug: string; window: string; nights: string[] }) {
  const q = useStarCurve(slug, window);
  if (q.isLoading) return <Skeleton className="h-[280px]" label="Loading light curve" />;
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} title="Couldn't load the light curve" />;
  const d = q.data;
  if (!d) return null;
  const { counts, status } = d;
  const fixture = isFixtureMode(d.mode);
  const checked = status.last_ok_utc ? `checked ${formatAge(status.last_ok_utc)}` : "not yet checked";
  const joined = d.bands_included.join(", ");
  const bands = joined.endsWith(".") ? joined : `${joined}.`;
  const shown = counts.every_nth > 1 ? `${counts.plotted_points} shown (every ${ordinal(counts.every_nth)})` : `${counts.plotted_points} shown`;
  return (
    <div className="flex flex-col gap-2">
      {fixture && <FixtureNotice />}
      {status.last_error && (
        <Notice tone="warn">
          AAVSO unreachable ({status.last_error}).{" "}
          {status.last_ok_utc ? `Last successful check ${formatAge(status.last_ok_utc)}.` : "No successful check yet."}
          {counts.cached > 0 ? " Showing what is already cached." : ""}
        </Notice>
      )}
      {counts.plotted_points > 0 ? (
        <LightCurve curve={d} nights={nights} />
      ) : (
        <p className="rounded-lg border border-line-soft px-3 py-6 text-center text-sm text-muted">
          {status.loading ? "Waiting for the first AAVSO observations." : "No V or visual observations are cached for this window."}
        </p>
      )}
      {status.loading && (
        <p role="status" className="text-xs text-ink-2">
          Loading history: {status.coverage_days}/{status.target_days} days
        </p>
      )}
      <p className="text-xs text-muted">
        {fixture ? "Synthetic fixture data" : "AAVSO International Database via VSX"} · {counts.cached} observations cached · {shown} · {checked}
      </p>
      <p className="text-xs text-muted">
        Bands shown: {bands} {d.excluded_note}
      </p>
      <div className="flex flex-col gap-0.5 text-xs text-muted">
        {shownAttribution(d.attribution, d.mode).map((a) => (
          <p key={a}>{a}</p>
        ))}
      </div>
    </div>
  );
}
