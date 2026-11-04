import { Download } from "lucide-react";
import { useId, useState } from "react";
import { fetchScript, type ScriptKind, type SelectionCounts } from "../../api/processing";

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

/** The "or let the coach's script do it" box: what the script does, the disk it will use (before the download),
 *  how to run it, then the download. */
export function ScriptBlock({
  runId,
  which,
  frames,
  bytes,
  laterMaxBytes = null,
  disabledReason,
  lead,
  commandBelow,
  chosen = null,
  counts = null,
}: {
  runId: string;
  which: ScriptKind;
  frames: number;
  bytes: number | null;
  laterMaxBytes?: number | null; // prepare only: the most script 2 can add (an aligned copy of every frame)
  disabledReason: string | null;
  lead: string;
  commandBelow: boolean; // the step shows the siril-cli line under this box
  chosen?: { label: string; kept: number } | null; // stack only: the step-4 choice the script applies
  counts?: SelectionCounts | null; // stack only: which folder that choice's count was read from
}) {
  const n = frames.toLocaleString();
  const what =
    which === "prepare"
      ? `Script 1 converts, debayers and aligns all ${n} frames and filters none of them.${
          bytes !== null ? ` It writes about ${formatGB(bytes)} into process-coach/ next to lights/` : " It writes only into process-coach/ next to lights/"
        }${
          bytes !== null && laterMaxBytes !== null
            ? `; script 2 will add up to about ${formatGB(laterMaxBytes)} more (an aligned copy of each frame you keep, at most all ${n}), so allow about ${formatGB(bytes + laterMaxBytes)} in all`
            : ""
        }. It never changes lights/ or an existing process/ folder.`
      : `Script 2 applies your frame choice from step 4 and stacks the kept frames into process-coach/result_coach.fit${
          bytes !== null ? `, writing about ${formatGB(bytes)} more for their aligned copies` : ""
        }. Run it after script 1.`;
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-line px-3.5 py-3">
      <p className="text-sm leading-relaxed text-ink-2">
        <b className="text-ink">{lead}</b> {what}
      </p>
      {which === "stack" && chosen && (
        <p className="text-sm leading-relaxed text-ink-2">
          Your choice from step 4: <b className="text-ink">{chosen.label}</b>, keeping {chosen.kept.toLocaleString()} frames
          {counts ? ` as counted in ${counts.run_dir}/` : ""}.
        </p>
      )}
      {which === "stack" && counts?.note && (
        <p role="note" className="rounded-lg border border-warn/40 bg-warn/5 px-3.5 py-2.5 text-sm leading-relaxed text-ink-2">
          {counts.note}
        </p>
      )}
      <p className="text-sm leading-relaxed text-ink-2">
        To run it, make the night folder (the one that holds lights/) Siril&apos;s working folder. From a terminal, give the script&apos;s full
        path after <code className="text-xs text-ink">-s</code>, for example the Downloads folder you saved it to: a bare file name is looked up
        in the night folder, not in the folder your terminal is in
        {commandBelow ? (
          " (command below)"
        ) : (
          <>
            {" "}
            (<code className="text-xs text-ink">siril-cli -d &quot;&lt;night folder&gt;&quot; -s &quot;&lt;folder you saved it in&gt;/{SCRIPT_FILE[which]}&quot;</code>)
          </>
        )}
        . In Siril itself, add the folder holding the script to the script folders in Preferences (Scripts), then choose it from the Scripts
        menu.
      </p>
      {/* Keyed by script so one script's "Download started" status never carries over to the other step. */}
      <ScriptButton key={which} runId={runId} which={which} disabledReason={disabledReason} />
    </div>
  );
}
