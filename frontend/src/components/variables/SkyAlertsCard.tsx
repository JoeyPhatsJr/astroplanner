import { Link } from "react-router-dom";
import { useObserver } from "../../api/hooks";
import { useDismissAlert, useVariableAlerts, type SkyAlert } from "../../api/variables";
import { formatAge, formatTime, tzAbbrev } from "../../lib/time";
import { Notice, Skeleton } from "../ui/States";

/** Sky alerts (spec §7.2). Hidden entirely when AAVSO is off. Every row says how fresh its data is. */
export function SkyAlertsCard() {
  const q = useVariableAlerts();
  const dismiss = useDismissAlert();
  const o = useObserver();
  if (!o) return null;
  if (q.isLoading) return <Skeleton className="h-24" label="Checking sky alerts" />;
  if (q.error) return <Notice tone="warn">Couldn&apos;t check sky alerts: {q.error instanceof Error ? q.error.message : String(q.error)}</Notice>;
  if (!q.data || !q.data.enabled || q.data.alerts.length === 0) return null;
  return (
    <section className="panel flex flex-col gap-3 p-4" aria-labelledby="sky-alerts">
      <h2 id="sky-alerts" className="font-semibold tracking-tight text-lg">
        Sky alerts
      </h2>
      <ul className="flex flex-col gap-3">
        {q.data.alerts.map((a) => (
          <AlertRow key={a.star_id} a={a} tz={o.timezone} onDismiss={() => dismiss.mutate(a.slug)} dismissing={dismiss.isPending} />
        ))}
      </ul>
      {dismiss.error && <Notice tone="warn">Couldn&apos;t dismiss: {dismiss.error instanceof Error ? dismiss.error.message : String(dismiss.error)}</Notice>}
      {q.data.attribution?.map((t) => (
        <p key={t} className="text-xs text-muted">
          {t}
        </p>
      ))}
    </section>
  );
}

function AlertRow({ a, tz, onDismiss, dismissing }: { a: SkyAlert; tz: string; onDismiss: () => void; dismissing: boolean }) {
  const name = (
    <Link to={`/variables/${a.slug}`} className="font-semibold text-ink hover:text-ice hover:underline">
      {a.name}
    </Link>
  );
  const checked = a.checked_utc ? formatAge(a.checked_utc) : null;
  const ev = a.evidence;

  if (a.state === "unavailable")
    return (
      <li className="text-sm text-ink-2">
        {name} · No AAVSO data yet{a.last_error ? ` (${a.last_error})` : ""}
      </li>
    );

  if (a.state === "stale")
    return (
      <li className="flex flex-col gap-0.5 text-sm text-ink-2">
        <span>
          {name} · Stale · AAVSO last checked {checked}
          {a.last_error ? ` (${a.last_error})` : ""}
        </span>
        {ev.observers > 0 && (
          <span className="text-xs text-muted">
            last data showed {ev.observers} observers brighter than {ev.threshold}
          </span>
        )}
      </li>
    );

  if (a.state === "no_change")
    return (
      <li className="text-sm text-ink-2">
        {name} · no change{a.current_mag !== null ? ` · ${a.current_mag} V` : ""}
        <span className="block text-xs text-muted">AAVSO, checked {checked}</span>
      </li>
    );

  const v = a.visibility;
  const win = v?.best_window;
  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
        <span className="text-ink">
          {name} in outburst · ~{a.current_mag} V <span className="text-xs text-muted">({a.normal_text})</span>
        </span>
        {v && (
          <span className="text-xs text-ink-2">
            {win ? `up ${formatTime(win.start_utc, tz)}–${formatTime(win.end_utc, tz)} ${tzAbbrev(win.start_utc, tz)}` : `below ${v.min_altitude_deg}° tonight`}
          </span>
        )}
      </div>
      <p className="text-xs text-muted">
        {ev.observers} observers reported it brighter than {ev.threshold} in the last {ev.window_hours} h · AAVSO, checked {checked}
      </p>
      <div>
        <button type="button" className="btn btn-ghost" disabled={dismissing} onClick={onDismiss} aria-label={`Dismiss ${a.name} alert`}>
          Dismiss
        </button>
      </div>
    </li>
  );
}
