import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { SessionTarget } from "../../api/types";
import { formatTime } from "../../lib/time";

export function moveId(ids: string[], index: number, delta: -1 | 1): string[] {
  const j = index + delta;
  if (j < 0 || j >= ids.length) return ids;
  const next = ids.slice();
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

/** Ordered session targets with accessible reorder and remove controls. */
export function SessionTargetList({
  targets,
  tz,
  onReorder,
  onRemove,
  busy = false,
}: {
  targets: SessionTarget[];
  tz: string | null;
  onReorder: (ids: string[]) => void;
  onRemove: (sessionTargetId: string) => void;
  busy?: boolean;
}) {
  const sorted = [...targets].sort((a, b) => a.sort_order - b.sort_order);
  const ids = sorted.map((t) => t.id);
  return (
    <ol className="flex flex-col gap-1.5" aria-label="Session targets in order">
      {sorted.map((st, i) => {
        const name = st.target?.name ?? st.target_id;
        return (
          <li key={st.id} className="flex items-center gap-2 rounded-lg border border-line-soft bg-night-deep/60 px-2.5 py-2">
            <span className="w-5 text-center text-xs tabular-nums text-muted" aria-hidden>
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{name}</p>
              <p className="truncate text-xs text-muted">
                {st.target?.primary_designation}
                {st.planned_start_utc && st.planned_end_utc && tz
                  ? ` · planned ${formatTime(st.planned_start_utc, tz)}–${formatTime(st.planned_end_utc, tz)}`
                  : ""}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label={`Move ${name} up`}
              disabled={busy || i === 0}
              onClick={() => onReorder(moveId(ids, i, -1))}
            >
              <ArrowUp className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label={`Move ${name} down`}
              disabled={busy || i === sorted.length - 1}
              onClick={() => onReorder(moveId(ids, i, 1))}
            >
              <ArrowDown className="size-4" aria-hidden />
            </button>
            <button type="button" className="btn btn-ghost btn-icon text-warn" aria-label={`Remove ${name}`} disabled={busy} onClick={() => onRemove(st.id)}>
              <Trash2 className="size-4" aria-hidden />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
