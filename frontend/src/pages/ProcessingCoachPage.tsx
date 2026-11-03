import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { usePatchRun, useRun, useStartRun, type RunOut } from "../api/processing";
import { CoachRail } from "../components/processing/CoachRail";
import { StepPanel } from "../components/processing/StepPanel";
import { EmptyState, ErrorState, Notice, Skeleton } from "../components/ui/States";
import { formatCalendarDate } from "../lib/time";

export function ProcessingCoachPage() {
  const { captureSetId } = useParams();
  const start = useStartRun();
  const startedFor = useRef<string | null>(null);
  const { mutate } = start;
  useEffect(() => {
    if (captureSetId && startedFor.current !== captureSetId) {
      startedFor.current = captureSetId;
      mutate(captureSetId);
    }
  }, [captureSetId, mutate]);

  const runId = start.data?.id;
  const run = useRun(runId);

  if (!captureSetId)
    return (
      <EmptyState title="No night chosen" action={<Link to="/astrolog" className="btn">Back to library</Link>}>
        Open a Seestar S30 night from a target page to start the coach.
      </EmptyState>
    );
  if (start.error)
    return (
      <ErrorState
        error={start.error}
        title="Couldn't start the coach"
        onRetry={() => start.mutate(captureSetId)}
      />
    );
  const data = run.data ?? start.data;
  if (!data || start.isPending)
    return (
      <div className="mx-auto flex max-w-[1100px] flex-col gap-3" role="status" aria-label="Loading the coach">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72" />
      </div>
    );
  return <Coach run={data} loadError={run.error} />;
}

function Coach({ run, loadError }: { run: RunOut; loadError: unknown }) {
  const patch = usePatchRun(run.id);
  const navigate = useNavigate();
  const [currentId, setCurrentId] = useState<string>(() => (run.steps.find((s) => s.state !== "done") ?? run.steps[0]).id);
  const idx = Math.max(0, run.steps.findIndex((s) => s.id === currentId));
  const step = run.steps[idx];
  const last = idx === run.steps.length - 1;
  const targetPath = `/astrolog/targets/${run.target.id}`;

  const markDone = async (then: () => void) => {
    try {
      await patch.mutateAsync({ step_states: { [step.id]: "done" } });
      then();
    } catch {
      /* shown below */
    }
  };

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4">
      <Link to={targetPath} className="inline-flex items-center gap-1.5 self-start text-sm text-ice hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> {run.target.name}
      </Link>
      <div>
        <p className="text-xs text-muted">
          AstroLog › {run.target.name} › Night of {formatCalendarDate(run.night.night_date, true)}
        </p>
        <h1 className="font-semibold tracking-tight text-3xl">Processing coach</h1>
        <p className="mt-1 text-sm text-ink-2">
          {run.frames.toLocaleString()} frames{run.exptime_s !== null ? ` of ${run.exptime_s} s` : ""} · written for Siril {run.siril_target}
        </p>
      </div>
      {loadError ? <Notice tone="warn">Couldn&apos;t refresh the run; showing the last saved state.</Notice> : null}
      {patch.error ? <Notice tone="warn">{patch.error instanceof Error ? patch.error.message : String(patch.error)}</Notice> : null}
      <div className="flex flex-col gap-4 min-[720px]:flex-row min-[720px]:items-start">
        <CoachRail steps={run.steps} currentId={step.id} onSelect={setCurrentId} />
        <StepPanel
          step={step}
          total={run.steps.length}
          actions={
            <>
              <button type="button" className="btn" disabled={idx === 0} onClick={() => setCurrentId(run.steps[idx - 1].id)}>
                Back
              </button>
              {step.blocked ? (
                // A blocked step cannot be marked done; moving on records nothing.
                last ? (
                  <Link to={targetPath} className="btn btn-primary">
                    Back to {run.target.name}
                  </Link>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={() => setCurrentId(run.steps[idx + 1].id)}>
                    Next
                  </button>
                )
              ) : last ? (
                <button type="button" className="btn btn-primary" disabled={patch.isPending} onClick={() => void markDone(() => navigate(targetPath))}>
                  Save to AstroLog
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={patch.isPending}
                  onClick={() => void markDone(() => setCurrentId(run.steps[idx + 1].id))}
                >
                  Done, next step
                </button>
              )}
            </>
          }
        />
      </div>
    </div>
  );
}
