import { Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { useVariables, type VariableListItem } from "../api/variables";
import { TonightWindow } from "../components/variables/TonightWindow";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";

export function vsxRange(v: VariableListItem["vsx"]): string {
  if (v.max_mag === null || v.min_mag === null) return "range not listed";
  return `range ${v.max_mag}–${v.min_mag}${v.band ? ` ${v.band}` : ""} (VSX)`;
}

export function VariableHunterPage() {
  const q = useVariables();
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <div>
        <h1 className="font-semibold tracking-tight text-3xl md:text-[2.4rem]">Variable Hunter</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-2">
          A short, curated list of variable stars that a Seestar can follow. Tonight&apos;s windows are calculated for your saved location.
        </p>
      </div>
      {q.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Couldn't load the variable stars" />
      ) : !q.data || q.data.stars.length === 0 ? (
        <EmptyState icon={<Sparkles className="size-6" />} title="No variable stars listed">
          The curated list is empty.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Variable stars">
          {q.data.stars.map((s) => (
            <li key={s.id} className="contents">
              <Link to={`/variables/${s.slug}`} className="panel flex flex-col gap-2 p-4 hover:border-ice/40">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold tracking-tight text-xl text-ink">{s.name}</span>
                  <span className="badge">{s.type_label}</span>
                </span>
                <span className="text-sm text-ink-2">
                  {s.constellation} · {vsxRange(s.vsx)}
                </span>
                <TonightWindow slug={s.slug} plain />
                <span className="text-sm text-ink-2">Your nights: {s.nights_count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {q.data && (
        <div className="flex flex-col gap-0.5 text-xs text-muted">
          <p>Catalog data: International Variable Star Index (VSX), operated at AAVSO, Cambridge, Massachusetts, USA.</p>
          {q.data.aavso.enabled && <p>Observations from the AAVSO International Database, contributed by observers worldwide. © AAVSO.</p>}
        </div>
      )}
    </div>
  );
}
