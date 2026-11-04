import { FileUp } from "lucide-react";
import { useRef } from "react";
import { useUploadStack, type StackEntry } from "../../api/processing";

/** Adds (or replaces) the developer's Siril stack. The file is measured in memory by the local backend and not kept. */
export function StackUpload({ runId, entry }: { runId: string; entry: StackEntry | null }) {
  const upload = useUploadStack(runId);
  const inputRef = useRef<HTMLInputElement>(null);
  const onPick = (list: FileList | null) => {
    const file = list?.[0];
    if (inputRef.current) inputRef.current.value = ""; // so picking the same file again still fires
    if (file) upload.mutate({ side: "siril", file });
  };
  const error = upload.error ? (upload.error instanceof Error ? upload.error.message : String(upload.error)) : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          id="coach-siril-stack"
          type="file"
          accept=".fit,.fits,.fts"
          className="peer sr-only"
          disabled={upload.isPending}
          onChange={(e) => onPick(e.target.files)}
        />
        <label
          htmlFor="coach-siril-stack"
          className={`btn ${entry ? "" : "btn-primary"} peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ice ${upload.isPending ? "pointer-events-none opacity-50" : "cursor-pointer"}`}
        >
          <FileUp className="size-4" aria-hidden /> {entry ? "Replace your Siril stack (FITS)" : "Add your Siril stack (FITS)"}
        </label>
        {entry && !upload.isPending && (
          <span className="text-sm text-ink-2">
            Measured {entry.source_filename} ({entry.measurement.width} x {entry.measurement.height} px)
          </span>
        )}
      </div>
      <p className="text-xs text-muted">
        The stack is measured on this computer&apos;s AstroPlanner backend and is not kept; only the numbers and a small preview are saved.
      </p>
      {upload.isPending && (
        <p role="status" className="text-sm text-ink-2">
          Measuring the stack…
        </p>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-warn/40 bg-warn/5 px-3.5 py-2.5 text-sm leading-relaxed text-ink-2">
          {error}
        </div>
      )}
    </div>
  );
}
