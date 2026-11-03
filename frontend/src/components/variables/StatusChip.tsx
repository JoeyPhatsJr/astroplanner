import { useVariableAlerts, type AlertState } from "../../api/variables";

const LABEL: Record<AlertState, { text: string; tone: string }> = {
  alert: { text: "In outburst", tone: "border-warn/50 text-warn" },
  no_change: { text: "No change", tone: "border-line text-ink-2" },
  stale: { text: "Stale", tone: "border-line text-muted" },
  unavailable: { text: "No AAVSO data yet", tone: "border-line text-muted" },
};

/**
 * The star's sky-alert state, read from the shared alerts query (no extra request). Rendered only for a
 * star the alerts list includes, i.e. one with an alert rule; mount it only when AAVSO is on.
 */
export function StatusChip({ starId }: { starId: string }) {
  const q = useVariableAlerts();
  const a = q.data?.enabled ? q.data.alerts.find((x) => x.star_id === starId) : undefined;
  if (!a) return null;
  const { text, tone } = LABEL[a.state];
  return (
    <span className={`badge ${tone}`} aria-label={`AAVSO status: ${text}`}>
      {text}
    </span>
  );
}
