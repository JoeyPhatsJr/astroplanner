import type { LastChoice, SelectionOption } from "../../api/processing";
import { formatCalendarDate, formatIntegration } from "../../lib/time";
import { BASIS_LABEL } from "./AdviceList";

// Short trade-off words in the spirit of mockup option B. They name a direction, not a winner.
const TAG: Record<string, string> = {
  previous: "Sharper",
  all: "Smoother",
  round80: "Rounder stars",
  wfwhm80: "Tighter stars",
};

export function SelectionStep({
  options,
  lastTime,
  chosen,
  pending,
  cleared = false,
  onChoose,
}: {
  options: SelectionOption[];
  lastTime: LastChoice | null;
  chosen: string | null;
  pending: boolean;
  cleared?: boolean;
  onChoose: (id: string) => void;
}) {
  if (options.length === 0)
    return (
      <p role="note" className="rounded-lg border border-line px-3.5 py-2.5 text-sm text-muted">
        There are no frame options yet. Read your Siril folder in step 1; the options are worked out from the frames it aligned.
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      {cleared && (
        <p role="status" className="rounded-lg border border-warn/40 bg-warn/5 px-3.5 py-2.5 text-sm text-ink-2">
          Your frame choice was cleared because the Siril folder was re-read; the counts may have changed. Choose again.
        </p>
      )}
      {lastTime && (
        <p className="text-sm text-ink-2">
          Last time ({formatCalendarDate(lastTime.night_date)}, {lastTime.target_name}) you chose &ldquo;{lastTime.option_label}&rdquo; and kept{" "}
          {lastTime.kept.toLocaleString()} frames. Nothing is chosen for you here.
        </p>
      )}
      <fieldset className="flex flex-col gap-2" disabled={pending}>
        <legend className="mb-1 text-sm font-medium text-ink">Which frames go into the stack?</legend>
        {options.map((o) => {
          const on = chosen === o.id;
          return (
            <label
              key={o.id}
              className={`flex cursor-pointer gap-3 rounded-lg border px-3.5 py-3 focus-within:ring-2 focus-within:ring-ice ${
                on ? "border-ice bg-ice/5" : "border-line"
              }`}
            >
              <input type="radio" name="frame-selection" className="mt-1 accent-ice" checked={on} onChange={() => onChoose(o.id)} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {TAG[o.id] && <b className="text-ice">{TAG[o.id]}</b>}
                  <span className="font-medium text-ink">{o.label}</span>
                  <span className="badge">{BASIS_LABEL[o.basis]}</span>
                  {o.heuristic && <span className="badge border-ice/40 text-ice">Heuristic</span>}
                </span>
                <span className="mt-1 block text-sm text-ink">
                  {o.kept.toLocaleString()} frames &middot; {formatIntegration(o.seconds)}
                </span>
                <span className="mt-0.5 block text-sm leading-relaxed text-ink-2">{o.note}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
