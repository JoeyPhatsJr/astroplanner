import { FolderOpen, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { useUploadFolder } from "../../api/processing";
import { readNightFolder, type FolderRun, type NightFolder } from "../../lib/nightFolder";

const LABEL = "Choose the night folder (the one containing lights/)";

export function FolderPicker({ runId, hasReport }: { runId: string; hasReport: boolean }) {
  const upload = useUploadFolder(runId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState<NightFolder | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [choice, setChoice] = useState<string>("");

  const send = (run: FolderRun, calibrationDirs: string[]) => {
    setProblem(null);
    upload.mutate(
      { run_dir: run.runDir, files: run.files, calibration_dirs: calibrationDirs },
      { onSuccess: () => setPending(null) },
    );
  };

  const onPick = async (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (inputRef.current) inputRef.current.value = ""; // so picking the same folder again still fires
    if (files.length === 0) return;
    setProblem(null);
    setPending(null);
    setSkipped([]);
    upload.reset();
    setReading(true);
    try {
      const folder = await readNightFolder(files);
      setSkipped(folder.skipped);
      if (folder.runs.length === 0) {
        setProblem(
          folder.skipped.length > 0
            ? "No Siril sequence (.seq) could be read: the file(s) listed below are over 5 MB, so they were not opened."
            : "No Siril sequence (.seq) was found in a subfolder of that folder. Pick the night folder that contains lights/ and the folder Siril wrote its working files to.",
        );
      } else if (folder.runs.length === 1) {
        send(folder.runs[0], folder.calibrationDirs);
      } else {
        setPending(folder);
        setChoice(folder.runs[0].runDir);
      }
    } catch (e) {
      setProblem(`Couldn't read that folder: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReading(false);
    }
  };

  const busy = reading || upload.isPending;
  const error = problem ?? (upload.error ? (upload.error instanceof Error ? upload.error.message : String(upload.error)) : null);
  const chosen = pending?.runs.find((r) => r.runDir === choice);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          id="coach-folder"
          type="file"
          className="peer sr-only"
          multiple
          // Non-standard but supported by every current browser.
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          disabled={busy}
          onChange={(e) => void onPick(e.target.files)}
        />
        {hasReport ? (
          <>
            <label htmlFor="coach-folder" className="sr-only">
              {LABEL}
            </label>
            <button type="button" className="btn" disabled={busy} onClick={() => inputRef.current?.click()}>
              <RefreshCw className="size-4" aria-hidden /> Re-read folder
            </button>
          </>
        ) : (
          <label htmlFor="coach-folder" className={`btn btn-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ice ${busy ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
            <FolderOpen className="size-4" aria-hidden /> {LABEL}
          </label>
        )}
      </div>
      <p className="text-xs text-muted">
        Only Siril&apos;s .seq and conversion text files are read, in your browser. Your light frames are never opened, and no pixels leave your computer.
      </p>
      {busy && (
        <p role="status" className="text-sm text-ink-2">
          {reading ? "Reading the folder…" : "Building the night report…"}
        </p>
      )}
      {pending && (
        <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <legend id="coach-which" className="px-1 text-sm font-medium text-ink">
            Which Siril folder should the coach use?
          </legend>
          <div role="radiogroup" aria-labelledby="coach-which" className="flex flex-col gap-1.5">
            {pending.runs.map((r) => (
              <label key={r.runDir} className="flex items-center gap-2 text-sm text-ink-2">
                <input type="radio" name="coach-run" checked={choice === r.runDir} onChange={() => setChoice(r.runDir)} />
                <span>
                  {r.runDir} <span className="text-xs text-muted">({r.files.length} text file{r.files.length === 1 ? "" : "s"})</span>
                </span>
              </label>
            ))}
          </div>
          <div>
            <button type="button" className="btn btn-primary" disabled={busy || !chosen} onClick={() => chosen && send(chosen, pending.calibrationDirs)}>
              Read this folder
            </button>
          </div>
        </fieldset>
      )}
      {skipped.length > 0 && <p className="text-xs text-muted">Skipped (over 5 MB): {skipped.join(", ")}</p>}
      {error && (
        <div role="alert" className="rounded-lg border border-warn/40 bg-warn/5 px-3.5 py-2.5 text-sm leading-relaxed text-ink-2">
          {error}
        </div>
      )}
    </div>
  );
}
