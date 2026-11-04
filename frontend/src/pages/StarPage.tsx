import { ArrowLeft, Check, ExternalLink, Plus } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useCurrentEquipment, useObserver } from "../api/hooks";
import { useStar, useStarVisibility, type StarResponse } from "../api/variables";
import { MissionCard } from "../components/variables/MissionCard";
import { StarExplainer } from "../components/variables/StarExplainer";
import { TonightWindow } from "../components/variables/TonightWindow";
import { EmptyState, ErrorState, Notice, Skeleton } from "../components/ui/States";
import { useActiveSession } from "../state/activeSession";
import { vsxRange } from "./VariableHunterPage";

export function StarPage() {
  const { slug } = useParams();
  const q = useStar(slug);
  if (q.isLoading)
    return (
      <div className="mx-auto flex max-w-[1100px] flex-col gap-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48" />
      </div>
    );
  if (q.error) {
    const notFound = (q.error as { status?: number }).status === 404;
    if (notFound)
      return (
        <EmptyState title="Star not found" action={<Link to="/variables" className="btn">Back to Variable Hunter</Link>}>
          That star is not in the curated list.
        </EmptyState>
      );
    return <ErrorState error={q.error} onRetry={() => q.refetch()} title="Couldn't load this star" />;
  }
  if (!q.data) return null;
  return <StarBody data={q.data} slug={slug as string} />;
}

function AddToPlan({ starId, slug }: { starId: string; slug: string }) {
  const o = useObserver();
  const vis = useStarVisibility(slug);
  const active = useActiveSession();
  const v = vis.data?.visibility;
  const inSession = active.inSession(starId);
  const reason = !o
    ? "Set a location in Settings to plan this star."
    : vis.isLoading
      ? "Checking tonight's visibility."
      : !v
        ? "Tonight's visibility is unavailable."
        : !v.can_observe
          ? v.status_text
          : null;
  const disabled = inSession || active.isAdding || reason !== null;
  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        className={`btn ${inSession ? "btn-ghost text-ice" : "btn-primary"}`}
        disabled={disabled}
        aria-describedby={reason ? "vh-add-reason" : undefined}
        onClick={() => active.addTarget(starId, v?.best_window ?? null)}
      >
        {inSession ? <Check className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
        {inSession ? "In tonight's plan" : "Add to tonight's plan"}
      </button>
      {reason && !inSession && (
        <p id="vh-add-reason" className="text-xs text-muted">
          {reason}
        </p>
      )}
      {active.error && <Notice tone="warn">{active.error}</Notice>}
    </div>
  );
}

function StarBody({ data, slug }: { data: StarResponse; slug: string }) {
  const eq = useCurrentEquipment();
  const { star } = data;
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <Link to="/variables" className="inline-flex items-center gap-1.5 self-start text-sm text-ice hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Variable Hunter
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-semibold tracking-tight text-3xl md:text-[2.4rem]">{star.name}</h1>
          <p className="mt-1 text-sm text-ink-2">
            {data.type_label} · {star.constellation} · {vsxRange(data.vsx)}
          </p>
          {data.period_note && <p className="mt-0.5 text-xs text-muted">{data.period_note}</p>}
        </div>
        <AddToPlan starId={star.id} slug={slug} />
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="panel p-4">
          <dt className="label">Tonight</dt>
          <dd className="mt-1">
            <TonightWindow slug={slug} bare />
          </dd>
        </div>
        <div className="panel p-4">
          <dt className="label">Your nights</dt>
          <dd className="mt-1 text-sm text-ink">{data.nights.length === 0 ? "None yet" : data.nights.length}</dd>
        </div>
      </dl>

      <section className="panel flex flex-col gap-2 p-4" aria-labelledby="vh-curve">
        <h2 id="vh-curve" className="label">
          Light curve
        </h2>
        <p className="text-sm text-ink-2">
          AstroPlanner doesn&apos;t download AAVSO observations, so it draws no light curve. AAVSO&apos;s own pages have this star&apos;s
          record.
        </p>
        <a href={data.source_url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 self-start text-sm text-ice hover:underline">
          View {star.primary_designation} on AAVSO VSX <span aria-hidden>→</span>
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </section>

      {data.missions.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="vh-missions">
          <h2 id="vh-missions" className="font-semibold tracking-tight text-lg">
            Missions
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {data.missions.map((m) => (
              <MissionCard key={m.key} mission={m} />
            ))}
          </div>
        </section>
      )}

      {data.seestar_fit && (
        <section className="panel flex flex-col gap-1 p-4" aria-labelledby="vh-fit">
          <h2 id="vh-fit" className="label">
            Seestar fit{eq ? ` · ${eq.name}` : ""}
          </h2>
          <p className="text-sm text-ink-2">{data.seestar_fit.text}</p>
        </section>
      )}

      <StarExplainer sourceUrl={data.source_url} starName={star.primary_designation} />

      <section className="panel p-4" aria-labelledby="vh-p4">
        <h2 id="vh-p4" className="label">
          Planned for a later phase
        </h2>
        <p className="mt-1 text-sm text-ink-2">Your own brightness measurements from your frames, plotted on the light curve with error bars.</p>
      </section>

      <div className="flex flex-col gap-0.5 text-xs text-muted">
        {data.attribution.map((a) => (
          <p key={a}>{a}</p>
        ))}
        <p>Facts retrieved {data.retrieved}.</p>
      </div>
    </div>
  );
}
