import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { usePatchRun, useRun, useStartRun, type RunOut } from "../api/processing";
import { CoachRail } from "../components/processing/CoachRail";
import { CompareStep } from "../components/processing/CompareStep";
import { FolderPicker } from "../components/processing/FolderPicker";
import { NightReport } from "../components/processing/NightReport";
import { ScriptBlock } from "../components/processing/ScriptButton";
import { SelectionStep } from "../components/processing/SelectionStep";
import { StackUpload } from "../components/processing/StackUpload";
import { StepPanel } from "../components/processing/StepPanel";
import { EmptyState, ErrorState, Notice, Skeleton } from "../components/ui/States";
import { formatCalendarDate } from "../lib/time";
import { PageHeader } from "../components/ui/PageHeader";

const CLEARED_TEXT = "Your frame choice was cleared because the Siril folder was re-read; the counts may have changed. Choose again in step 4.";

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
      <div className="page-wide flex flex-col gap-3" role="status" aria-label="Loading the coach">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72" />
      </div>
    );
  return <Coach run={data} loadError={run.error} />;
}

function Coach({ run, loadError }: { run: RunOut; loadError: unknown }) {
  const patch = usePatchRun(run.id);
  const navigate = useNavigate();
  const [cleared, setCleared] = useState(false);
  const [currentId, setCurrentId] = useState<string>(() => (run.steps.find((s) => s.state !== "done") ?? run.steps[0]).id);
  const idx = Math.max(0, run.steps.findIndex((s) => s.id === currentId));
  const step = run.steps[idx];
  const last = idx === run.steps.length - 1;
  const targetPath = `/astrolog/targets/${run.target.id}`;
  const chosenOption = run.selection.find((o) => o.id === run.choices?.selection) ?? null;
  const countsNote = run.selection_counts?.note ?? null;

  const markDone = async (then: () => void) => {
    try {
      await patch.mutateAsync({ step_states: { [step.id]: "done" } });
      then();
    } catch {
      /* shown below */
    }
  };

  return (
    <div className="page-wide flex flex-col gap-4">
      <PageHeader
        title="Processing coach"
        back={{ to: targetPath, label: run.target.name }}
        subtitle={
          <>
            <p className="text-xs text-muted">
              AstroLog › {run.target.name} › Night of {formatCalendarDate(run.night.night_date, true)}
            </p>
            <p className="mt-1">
              {run.frames.toLocaleString()} frames{run.exptime_s !== null ? ` of ${run.exptime_s} s` : ""} · written for Siril {run.siril_target}
            </p>
          </>
        }
      />
      {loadError ? <Notice tone="warn">Couldn&apos;t refresh the run; showing the last saved state.</Notice> : null}
      {patch.error ? <Notice tone="warn">{patch.error instanceof Error ? patch.error.message : String(patch.error)}</Notice> : null}
      <div className="flex flex-col gap-4 min-[720px]:flex-row min-[720px]:items-start">
        <CoachRail steps={run.steps} currentId={step.id} onSelect={setCurrentId} />
        <StepPanel
          step={step}
          total={run.steps.length}
          script={
            run.scripts && (step.id === "convert" || (step.id === "report" && !run.report)) ? (
              <ScriptBlock
                runId={run.id}
                which="prepare"
                frames={run.frames}
                bytes={run.scripts.prepare_bytes}
                laterMaxBytes={run.scripts.stack_max_bytes}
                disabledReason={null}
                commandBelow={!!step.command}
                lead={step.id === "report" ? "No Siril run yet? Let the coach's script make one." : "Or let the coach's script do steps 2 and 3."}
              />
            ) : run.scripts && step.id === "stack" ? (
              <ScriptBlock
                runId={run.id}
                which="stack"
                frames={run.frames}
                bytes={run.scripts.stack_bytes}
                disabledReason={run.scripts.stack_blocked}
                commandBelow={!!step.command}
                chosen={chosenOption}
                counts={run.selection_counts ?? null}
                lead="Or let the coach's script do it."
              />
            ) : undefined
          }
          body={
            step.id === "report" ? (
              <div className="flex flex-col gap-4">
                {run.report && <NightReport report={run.report} folder={run.folder} />}
                {cleared && <Notice tone="warn">{CLEARED_TEXT}</Notice>}
                <FolderPicker runId={run.id} hasReport={!!run.report} onSelectionCleared={() => setCleared(true)} />
              </div>
            ) : step.id === "select" && !step.blocked ? (
              <SelectionStep
                cleared={cleared}
                countsNote={countsNote}
                options={run.selection}
                lastTime={run.selection_last_time ?? null}
                chosen={run.choices?.selection ?? null}
                pending={patch.isPending}
                onChoose={(id) => {
                  setCleared(false);
                  patch.mutate({ choices: { selection: id } });
                }}
              />
            ) : step.id === "background" || step.id === "colour" || step.id === "stretch" ? (
              <StackUpload runId={run.id} entry={run.comparison.siril_stack} />
            ) : step.id === "compare" ? (
              <CompareStep run={run} />
            ) : undefined
          }
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
