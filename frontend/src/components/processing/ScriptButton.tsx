import { Download } from "lucide-react";
import { useId, useState } from "react";
import { fetchScript, type ScriptKind } from "../../api/processing";

const LABEL: Record<ScriptKind, string> = { prepare: "script 1 (prepare)", stack: "script 2 (stack)" };
// Display only; the downloaded file is named by the server's Content-Disposition.
const SCRIPT_FILE: Record<ScriptKind, string> = { prepare: "astroplanner-prepare.ssf", stack: "astroplanner-stack.ssf" };

/** Disk figures in decimal gigabytes, the unit Finder shows. */
export function formatGB(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/** Downloads one generated Siril script as a real file, named exactly as the server's Content-Disposition says.
 *  While `disabledReason` is set the button is disabled and the reason is shown under it. */
export function ScriptButton({ runId, which, disabledReason }: { runId: string; which: ScriptKind; disabledReason: string | null }) {
  const reasonId = useId();
  const [state, setState] = useState<{ status: "idle" | "pending" | "done" | "error"; text?: string }>({ status: "idle" });

  const download = async () => {
    setState({ status: "pending" });
    try {
      const { filename, blob } = await fetchScript(runId, which);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setState({ status: "done", text: filename });
    } catch (e) {
      setState({ status: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <button
          type="button"
          className="btn"
          disabled={!!disabledReason || state.status === "pending"}
          aria-describedby={disabledReason ? reasonId : undefined}
          onClick={() => void download()}
        >
          <Download className="size-4" aria-hidden />
          {state.status === "pending" ? "Preparing the script…" : `Download ${LABEL[which]}`}
        </button>
      </div>
      {disabledReason && (
        <p id={reasonId} className="text-sm text-muted">
          {disabledReason}
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-sm text-warn">
          Couldn&apos;t download the script: {state.text}
        </p>
      )}
      {state.status === "done" && (
        <p role="status" className="text-sm text-ink-2">
          Download started: {state.text}
        </p>
      )}
    </div>
  );
}

/** The "or let the coach's script do it" box: what the script does, the disk it will use, then the download. */
export function ScriptBlock({
  runId,
  which,
  frames,
  bytes,
  disabledReason,
  lead,
  commandBelow,
}: {
  runId: string;
  which: ScriptKind;
  frames: number;
  bytes: number | null;
  disabledReason: string | null;
  lead: string;
  commandBelow: boolean; // the step shows the siril-cli line under this box
}) {
  const what =
    which === "prepare"
      ? `Script 1 converts, debayers and aligns all ${frames.toLocaleString()} frames and filters none of them. It writes only into process-coach/ next to lights/${
          bytes !== null ? `, about ${formatGB(bytes)}` : ""
        }, and never changes lights/ or an existing process/ folder.`
      : `Script 2 applies your frame choice from step 4 and stacks the kept frames into process-coach/result_coach.fit${
          bytes !== null ? `, writing about ${formatGB(bytes)} more for their aligned copies` : ""
        }. Run it after script 1.`;
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-line px-3.5 py-3">
      <p className="text-sm leading-relaxed text-ink-2">
        <b className="text-ink">{lead}</b> {what} Make the night folder (the one that holds lights/) Siril&apos;s working folder, then run the
        file from Siril&apos;s Scripts menu or{" "}
        {commandBelow ? "with the command below" : <code className="text-xs text-ink">siril-cli -d &quot;&lt;night folder&gt;&quot; -s {SCRIPT_FILE[which]}</code>}.
      </p>
      <ScriptButton runId={runId} which={which} disabledReason={disabledReason} />
    </div>
  );
}
