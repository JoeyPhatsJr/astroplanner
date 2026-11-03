import { ImagePlus } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useLinkStack, useUploadFinalImage, type StackOut } from "../../api/astrolog";
import { suggestStackId } from "../../lib/stackSuggest";
import { formatIntegration } from "../../lib/time";
import { Notice } from "../ui/States";

/** Upload the finished picture for a target and optionally tie it to the stack it came from. */
export function FinalPicturePicker({
  targetId,
  stacks,
  suggestionId,
  currentImageId,
  currentStackId,
}: {
  targetId: string;
  stacks: StackOut[];
  suggestionId: string | null;
  currentImageId?: string;
  currentStackId?: string | null;
}) {
  const fileId = useId();
  const stackSel = useId();
  const upload = useUploadFinalImage(targetId);
  const link = useLinkStack(targetId);
  const [file, setFile] = useState<File | null>(null);
  // Before upload the suggestion comes from the CHOSEN file's name; until one is chosen, the server's.
  const suggestion = file ? suggestStackId(file.name, stacks) : suggestionId;
  const [stackId, setStackId] = useState<string>(suggestion ?? "");
  useEffect(() => setStackId(suggestion ?? ""), [suggestion]);
  const suggested = stacks.find((s) => s.id === suggestion);
  const err = upload.error ?? link.error;

  const submit = async () => {
    if (!file) return;
    await upload.mutateAsync({ file, stackId: stackId || null });
    setFile(null);
  };

  return (
    <div className="flex flex-col gap-3">
      {err && <Notice tone="warn">{err instanceof Error ? err.message : String(err)}</Notice>}
      <div>
        <label htmlFor={fileId} className="label">
          {currentImageId ? "Replace final picture" : "Final picture"}
        </label>
        <input
          id={fileId}
          type="file"
          accept=".jpg,.jpeg,.png,.tif,.tiff,.fit,.fits,image/jpeg,image/png,image/tiff"
          className="field"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <p className="mt-1 text-xs text-muted">JPEG, PNG, TIFF or FITS, up to 150 MB. Only a preview is kept; your file stays where it is.</p>
      </div>
      {stacks.length > 0 && (
        <div>
          <label htmlFor={stackSel} className="label">
            Stacked from
          </label>
          <select id={stackSel} className="field py-1.5" value={stackId} onChange={(e) => setStackId(e.target.value)}>
            <option value="">No linked stack</option>
            {stacks.map((s) => (
              <option key={s.id} value={s.id}>
                {s.source_filename} ({formatIntegration(s.integration_s)}){s.id === suggestion ? " · suggested" : ""}
              </option>
            ))}
          </select>
          {suggested && !stackId && <p className="mt-1 text-xs text-muted">Suggested: {suggested.source_filename}</p>}
        </div>
      )}
      <div>
        <button type="button" className="btn btn-primary" disabled={!file || upload.isPending} onClick={() => void submit().catch(() => undefined)}>
          <ImagePlus className="size-4" aria-hidden /> {upload.isPending ? "Uploading…" : "Upload picture"}
        </button>
      </div>
      {currentImageId && stacks.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <div>
            <label htmlFor={`${stackSel}-link`} className="label">
              Linked stack for current picture
            </label>
            <select
              id={`${stackSel}-link`}
              className="field py-1.5"
              value={currentStackId ?? ""}
              disabled={link.isPending}
              onChange={(e) => link.mutate({ final_image_id: currentImageId, stack_id: e.target.value || null })}
            >
              <option value="">No linked stack</option>
              {stacks.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.source_filename} ({formatIntegration(s.integration_s)})
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
