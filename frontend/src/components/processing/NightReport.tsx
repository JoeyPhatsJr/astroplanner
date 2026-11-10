import type { FolderInfo, NightReportData } from "../../api/processing";
import { FramesChart } from "../charts/LazyCharts";
import { formatIntegration } from "../../lib/time";
import { BASIS_LABEL } from "./AdviceList";

const n = (x: number) => x.toLocaleString("en-US");
const dur = formatIntegration; // floored, the same rule and format as AstroLog, step 4 and script 2

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="text-micro uppercase text-muted">{label}</dt>
      <dd className="m-0">
        <b className="text-[17px] text-ink">{value}</b>
        {note && <span className="ml-1.5 text-xs text-muted">{note}</span>}
      </dd>
    </div>
  );
}

function chartSummary(r: NightReportData): string {
  const b = r.bins;
  if (b.length === 0) return "Frames per half hour: no frames have a known capture time.";
  const peak = b.reduce((m, x) => (x.captured > m.captured ? x : m), b[0]);
  const tz = r.timezone ? "local time" : "UTC";
  return (
    `Frames per half hour, ${tz}: ${b.length} time bins from ${b[0].label_local} to ${b[b.length - 1].label_local}. ` +
    `Busiest bin ${peak.label_local} with ${peak.captured} frames captured. ` +
    `Each bar splits into frames in your stack, aligned but dropped, and not aligned.`
  );
}

export function NightReport({ report, folder }: { report: NightReportData; folder?: FolderInfo | null }) {
  const t = report.totals;
  const stars = report.medians.stars;
  const starRange = report.ranges.stars;
  const fwhm = report.medians.fwhm;
  const keptKnown = t.kept !== null;
  const keptDroppedExists = report.bins.length > 0;
  return (
    <div className="flex flex-col gap-4">
      <dl role="group" aria-label="Night totals" className="m-0 flex flex-wrap gap-x-6 gap-y-3">
        <Stat label="Frames captured" value={n(t.captured)} note={`= ${dur(t.captured_s)}`} />
        <Stat label="Aligned by Siril" value={n(t.aligned)} note={`= ${dur(t.aligned_s)}`} />
        <Stat
          label="In your stack"
          value={keptKnown ? n(t.kept as number) : "unknown"}
          note={keptKnown && t.kept_s !== null ? `= ${dur(t.kept_s)}` : undefined}
        />
        {stars !== null && stars !== undefined && (
          <Stat label="Stars per frame" value={String(Math.round(stars))} note={starRange ? `median (${starRange[0]}–${starRange[1]})` : "median"} />
        )}
        {fwhm !== null && fwhm !== undefined && <Stat label="Star size (FWHM)" value={`${fwhm.toFixed(2)} ${report.units.fwhm ?? "px"}`} note="median" />}
      </dl>
      {!keptKnown && (
        <p role="note" className="rounded-lg border border-warn/40 bg-warn/5 px-3.5 py-2.5 text-sm leading-relaxed text-ink-2">
          {folder?.kept_error ?? "The folder has no usable kept-frames sequence, so how many frames made it into your stack is unknown."}
        </p>
      )}

      <div className="grid gap-4 min-[900px]:grid-cols-2">
        <section aria-labelledby="frames-h" className="self-start rounded-lg border border-line p-3.5">
          <h3 id="frames-h" className="font-semibold text-ink">
            Frames through the night
          </h3>
          <p className="mb-2 text-xs text-muted">
            Every 30 minutes, {report.timezone ? `local time (${report.timezone})` : "UTC"}. Each bar is all the frames captured in that half hour.
          </p>
          {keptDroppedExists ? (
            <>
              <FramesChart bins={report.bins} summary={chartSummary(report)} />
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Chart legend">
                {keptKnown && (
                  <li className="flex items-center gap-1.5">
                    <i className="inline-block size-2.5 rounded-sm bg-ice" aria-hidden />In your stack
                  </li>
                )}
                <li className="flex items-center gap-1.5">
                  <i className={`inline-block size-2.5 rounded-sm ${keptKnown ? "bg-warn" : "bg-ice-dim"}`} aria-hidden />
                  {keptKnown ? "Aligned, dropped" : "Aligned"}
                </li>
                <li className="flex items-center gap-1.5">
                  <i className="inline-block size-2.5 rounded-sm bg-line" aria-hidden />Siril couldn&apos;t align
                </li>
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted">No frame in this folder has a known capture time, so there is nothing to chart.</p>
          )}
          {report.time_unknown > 0 && (
            <p className="mt-2 text-xs text-muted">{n(report.time_unknown)} frames have no known capture time and are not in the chart.</p>
          )}
        </section>

        <section aria-labelledby="stands-h" className="self-start rounded-lg border border-line p-3.5">
          <h3 id="stands-h" className="font-semibold text-ink">
            What stands out
          </h3>
          {report.findings.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nothing unusual in the numbers Siril recorded.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-3">
              {report.findings.map((f) => (
                <li key={f.id}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium text-ink">{f.title}</span>
                    <span className="badge">{BASIS_LABEL[f.basis]}</span>
                    {f.heuristic && <span className="badge border-ice/40 text-ice">Heuristic</span>}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-ink-2">{f.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
