import { Check, ExternalLink, Plus } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useCurrentEquipment, useObserver } from "../api/hooks";
import { useStar, useStarVisibility, type StarResponse } from "../api/variables";
import { MissionCard } from "../components/variables/MissionCard";
import { StarExplainer } from "../components/variables/StarExplainer";
import { TonightWindow } from "../components/variables/TonightWindow";
import { EmptyState, ErrorState, Notice, Skeleton } from "../components/ui/States";
import { useActiveSession } from "../state/activeSession";
import { vsxRange } from "./VariableHunterPage";
import { PageHeader } from "../components/ui/PageHeader";

export function StarPage() {
  const { slug } = useParams();
  const q = useStar(slug);
  if (q.isLoading)
    return (
      <div className="page-wide flex flex-col gap-3">
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
    <div className="page-wide flex flex-col gap-5">
      <PageHeader
        title={star.name}
        back={{ to: "/variables", label: "Variable Hunter" }}
        subtitle={
          <>
            <p>
              {data.type_label} · {star.constellation} · {vsxRange(data.vsx)}
            </p>
            {data.period_note && <p className="mt-0.5 text-xs text-muted">{data.period_note}</p>}
          </>
        }
        actions={<AddToPlan starId={star.id} slug={slug} />}
      />

      <dl className="panel grid gap-x-6 gap-y-3 p-4 sm:grid-cols-[auto_1fr]" aria-label="Summary">
        <dt className="label sm:pt-0.5">Tonight</dt>
        <dd className="m-0">
          <TonightWindow slug={slug} bare />
        </dd>
        {data.nights.length > 0 && (
          <>
            <dt className="label sm:pt-0.5">Your nights</dt>
            <dd className="m-0 text-sm text-ink">{data.nights.length}</dd>
          </>
        )}
        {data.seestar_fit && (
          <>
            <dt className="label sm:pt-0.5">Seestar fit{eq ? ` · ${eq.name}` : ""}</dt>
            <dd className="m-0 text-sm text-ink-2">{data.seestar_fit.text}</dd>
          </>
        )}
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

      <StarExplainer sourceUrl={data.source_url} starName={star.primary_designation} />

      <div className="flex flex-col gap-0.5 text-xs text-muted">
        {data.attribution.map((a) => (
          <p key={a}>{a}</p>
        ))}
        <p>Facts retrieved {data.retrieved}.</p>
      </div>
    </div>
  );
}
