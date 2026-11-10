import { useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useUploadFinalImage } from "../../api/astrolog";
import { qk } from "../../api/hooks";
import {
  usePatchRun,
  useUploadPicture,
  type CompareMeasurement,
  type ComparisonOut,
  type ComparisonStack,
  type RunOut,
} from "../../api/processing";
import { formatIntegration } from "../../lib/time";
import { imageSrc } from "../astrolog/TargetTile";
import { StackUpload } from "./StackUpload";

type Mode = "pictures" | "stacks";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The stack's LIVETIME header, floored like every other duration in the app ("1 h 49 m", "12 m 30 s"). */
const duration = formatIntegration;

/** A real file input behind a button-styled label (same focus-ring approach as StackUpload). */
function FilePick({
  id,
  label,
  accept,
  pending,
  pendingText,
  error,
  onFile,
}: {
  id: string;
  label: string;
  accept: string;
  pending: boolean;
  pendingText: string;
  error: unknown;
  onFile: (f: File) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <input
          id={id}
          type="file"
          accept={accept}
          className="peer sr-only"
          disabled={pending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // so picking the same file again still fires
            if (file) onFile(file);
          }}
        />
        <label
          htmlFor={id}
          className={`btn btn-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ice ${pending ? "pointer-events-none opacity-50" : "cursor-pointer"}`}
        >
          <FileUp className="size-4" aria-hidden /> {label}
        </label>
      </div>
      {pending && (
        <p role="status" className="text-sm text-ink-2">
          {pendingText}
        </p>
      )}
      {error ? (
        <div role="alert" className="rounded-lg border border-warn/40 bg-warn/5 px-3.5 py-2.5 text-sm leading-relaxed text-ink-2">
          {message(error)}
        </div>
      ) : null}
    </div>
  );
}

function Side({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section role="group" aria-label={title} className="panel flex min-w-0 flex-col gap-3 p-3">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="text-xs leading-relaxed text-muted">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function Missing({ title, children, action }: { title: string; children: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-line p-3 text-xs leading-relaxed text-muted">
      <p>
        <b className="text-ink-2">{title}</b> {children}
      </p>
      <div>{action}</div>
    </div>
  );
}

function Picture({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) {
  return (
    <img
      src={imageSrc(src)}
      alt={alt}
      width={width}
      height={height}
      className="vision-img mx-auto block h-auto max-h-[70vh] w-full rounded-lg border border-line-soft object-contain"
    />
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="flex flex-col gap-2 border-t border-line-soft pt-3 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-wrap items-baseline justify-between gap-x-3">
          <dt className="text-muted">{k}</dt>
          <dd className="ml-auto min-w-0 text-right font-medium text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const NOT_IN_FILE = (
  <>
    <span>—</span> <span className="text-xs font-normal text-muted">not in file</span>
  </>
);

/** Same rows, same labels, same method for both stacks. A missing header value is "—" with "not in file". */
function StackFacts({ m, note }: { m: CompareMeasurement; note: string | null }) {
  const rows: [string, ReactNode][] = [
    ["Frames", m.stack_count !== null ? m.stack_count.toLocaleString() : NOT_IN_FILE],
    ["Total exposure", m.livetime_s !== null ? duration(m.livetime_s) : NOT_IN_FILE],
    [
      "Star size (FWHM)",
      m.star_fwhm_px !== null ? (
        `${m.star_fwhm_px.toFixed(2)} px`
      ) : (
        <>
          <span>—</span> <span className="text-xs font-normal text-muted">too few usable stars</span>
        </>
      ),
    ],
    [
      "Background noise (relative, same method)",
      <>
        {(m.noise_frac * 100).toFixed(1)} %
        <span className="block text-xs font-normal text-muted">of the image&apos;s brightness range</span>
      </>,
    ],
  ];
  return (
    <>
      <Facts rows={rows} />
      {note && (
        <p role="note" className="rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs leading-relaxed text-ink-2">
          {note}
        </p>
      )}
    </>
  );
}

function binningNote(a: ComparisonStack | null, b: ComparisonStack | null): string | null {
  if (!a || !b) return null;
  if (a.measurement.method !== b.measurement.method)
    return "These two stacks were measured with different versions of the method, so their numbers are not comparable. Add them again to measure both the same way.";
  if ((a.measurement.bayer !== null) !== (b.measurement.bayer !== null))
    return "One stack is a raw Bayer image measured on 2×2 super-pixels and the other is already debayered, so their per-pixel noise and star size are not comparable. Compare their previews instead.";
  return null;
}

function PicturesMode({ run, c }: { run: RunOut; c: ComparisonOut }) {
  const qc = useQueryClient();
  const patch = usePatchRun(run.id);
  const uploadPicture = useUploadPicture(run.id);
  const uploadFinal = useUploadFinalImage(run.target.id);
  const sp = c.seestar_picture;
  const fp = c.final_picture;
  const setEdited = (edited: boolean | null) => patch.mutate({ comparison: { seestar_picture: { edited } } });
  const editedText = !sp
    ? ""
    : sp.edited === true
      ? `Yes${sp.edited_by ? `, ${sp.edited_by}` : ""}`
      : sp.edited === false
        ? "No"
        : "Unknown (the file doesn't say)";
  const choice = (label: string, value: boolean | null) => (
    <button type="button" className="btn aria-pressed:border-ice aria-pressed:text-ice" aria-pressed={sp?.edited === value} disabled={patch.isPending} onClick={() => setEdited(value)}>
      {label}
    </button>
  );
  return (
    <div className="grid gap-3.5 min-[640px]:grid-cols-2">
      <Side title="Seestar picture" subtitle="The picture you made from the Seestar's own result.">
        {sp ? (
          <>
            <Picture src={sp.preview_url} alt="Seestar picture of this target" width={sp.width} height={sp.height} />
            <Facts rows={[["Source", sp.source_filename], ["Edited", editedText], ["Size", `${sp.width} × ${sp.height}`]]} />
            <div role="group" aria-label="Was this picture edited?" className="flex flex-wrap gap-2">
              {choice("Edited", true)}
              {choice("Not edited", false)}
              {choice("Don't know", null)}
            </div>
            {patch.error ? (
              <div role="alert" className="rounded-lg border border-warn/40 bg-warn/5 px-3.5 py-2.5 text-sm text-ink-2">
                {message(patch.error)}
              </div>
            ) : null}
            <p className="text-xs leading-relaxed text-muted">
              No measurements for this side: an edited picture has been stretched by hand, so star size or noise read from it would not be fair.
            </p>
          </>
        ) : (
          <Missing
            title="No Seestar picture yet."
            action={
              <FilePick
                id="coach-seestar-picture"
                label="Add Seestar picture"
                accept=".jpg,.jpeg,.png,.tif,.tiff"
                pending={uploadPicture.isPending}
                pendingText="Reading the picture…"
                error={uploadPicture.error}
                onFile={(f) => uploadPicture.mutate(f)}
              />
            }
          >
            Add the JPEG, PNG or TIFF you made from the Seestar. Only a small preview is kept.
          </Missing>
        )}
      </Side>
      <Side title="Your final picture" subtitle="The current final picture of this target in AstroLog.">
        {fp ? (
          <>
            <Picture src={fp.preview_url} alt="Your final picture of this target" width={fp.width} height={fp.height} />
            <Facts rows={[["Source", fp.source_filename], ["Size", `${fp.width} × ${fp.height}`]]} />
          </>
        ) : (
          <Missing
            title="No final picture yet."
            action={
              <FilePick
                id="coach-final-picture"
                label="Add your final picture"
                accept=".jpg,.jpeg,.png,.tif,.tiff,.fit,.fits,.fts"
                pending={uploadFinal.isPending}
                pendingText="Saving the picture…"
                error={uploadFinal.error}
                onFile={(file) =>
                  uploadFinal.mutate({ file }, { onSuccess: () => void qc.invalidateQueries({ queryKey: qk.processingRun(run.id) }) })
                }
              />
            }
          >
            Add your finished picture to see it beside the Seestar&apos;s. It also becomes this target&apos;s final picture in AstroLog.
          </Missing>
        )}
      </Side>
    </div>
  );
}

function StacksMode({ run, c }: { run: RunOut; c: ComparisonOut }) {
  const note = binningNote(c.siril_stack, c.seestar_stack);
  return (
    <div className="grid gap-3.5 min-[640px]:grid-cols-2">
      <Side title="Seestar stack" subtitle="The Seestar's own stacked FITS, shown with the app's standard preview stretch.">
        {c.seestar_stack ? (
          <>
            <Picture
              src={c.seestar_stack.preview_url}
              alt="Seestar stack preview, auto-stretched"
              width={c.seestar_stack.measurement.width}
              height={c.seestar_stack.measurement.height}
            />
            <StackFacts m={c.seestar_stack.measurement} note={note} />
            <StackUpload runId={run.id} entry={c.seestar_stack} side="seestar" who="the Seestar FITS stack" compact />
          </>
        ) : (
          <Missing
            title="No measurements for this side yet."
            action={<StackUpload runId={run.id} entry={null} side="seestar" who="Seestar FITS stack" compact />}
          >
            Add the Seestar&apos;s own stacked FITS file (it is on the Seestar, in the target&apos;s folder) to measure it the same way as yours.
          </Missing>
        )}
      </Side>
      <Side title="Your Siril stack" subtitle="Stacked with your settings, shown with the same preview stretch.">
        {c.siril_stack ? (
          <>
            <Picture
              src={c.siril_stack.preview_url}
              alt="Siril stack preview, auto-stretched"
              width={c.siril_stack.measurement.width}
              height={c.siril_stack.measurement.height}
            />
            <StackFacts m={c.siril_stack.measurement} note={note} />
            <StackUpload runId={run.id} entry={c.siril_stack} compact />
          </>
        ) : (
          <Missing title="No stack yet." action={<StackUpload runId={run.id} entry={null} compact />}>
            Add the FITS stack you made in Siril to measure it.
          </Missing>
        )}
      </Side>
    </div>
  );
}

/** Step 10: the Seestar's result beside the developer's. Two modes; neither ranks anything. */
export function CompareStep({ run }: { run: RunOut }) {
  const c: ComparisonOut = run.comparison;
  const [mode, setMode] = useState<Mode>(() => (!c.mode_available.pictures && c.mode_available.stacks ? "stacks" : "pictures"));
  const seg = (m: Mode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => setMode(m)}
      className={`px-3 py-1.5 text-label font-semibold ${mode === m ? "bg-panel-2 text-ink" : "text-muted hover:text-ink"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="What to compare" className="inline-flex self-start overflow-hidden rounded-lg border border-line">
        {seg("pictures", "Final pictures")}
        {seg("stacks", "Stacks (measured)")}
      </div>
      {mode === "pictures" ? <PicturesMode run={run} c={c} /> : <StacksMode run={run} c={c} />}
      <p className="text-xs leading-relaxed text-muted">
        <b className="text-ink-2">Final pictures</b> is a fair look at the end results, but taste and editing differ, so it shows no numbers.{" "}
        <b className="text-ink-2">Stacks (measured)</b> puts the two unedited stacks side by side with the same preview stretch and the same measurements,
        each relative to its own image. Nothing here is ranked.
      </p>
    </div>
  );
}
