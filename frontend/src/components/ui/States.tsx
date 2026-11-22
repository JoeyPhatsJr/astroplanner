import { AlertTriangle, RotateCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

export function Skeleton({ className = "", label = "Loading" }: { className?: string; label?: string }) {
  return <div className={`skeleton ${className}`} role="status" aria-label={label} />;
}

/**
 * Shown under a skeleton that has been up a while. The API's free host sleeps after a quiet spell and
 * takes up to a minute to wake, which otherwise looks like a page that is stuck.
 */
export function SlowLoadHint({ afterMs = 5000 }: { afterMs?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), afterMs);
    return () => clearTimeout(t);
  }, [afterMs]);
  if (!show) return null;
  return (
    <p className="text-sm text-muted" role="status">
      Still loading. After a quiet spell the server needs up to a minute to wake up.
    </p>
  );
}

export function ErrorState({ error, onRetry, title = "Couldn't load this" }: { error: unknown; onRetry?: () => void; title?: string }) {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  return (
    <div role="alert" className="panel flex flex-col gap-3 border-warn/40 p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
        <div>
          <p className="font-semibold text-ink">{title}</p>
          <p className="mt-1 text-sm text-ink-2">{message}</p>
        </div>
      </div>
      {onRetry && (
        <div>
          <button type="button" className="btn" onClick={onRetry}>
            <RotateCw className="size-4" aria-hidden /> Try again
          </button>
        </div>
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-start gap-3 p-6">
      {icon && <div className="text-ice">{icon}</div>}
      <p className="font-semibold text-xl text-ink">{title}</p>
      {children && <div className="max-w-prose text-sm leading-relaxed text-ink-2">{children}</div>}
      {action}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  const cls = tone === "warn" ? "border-warn/40 bg-warn/5" : "border-ice/25 bg-ice/5";
  return <div className={`rounded-lg border px-3.5 py-2.5 text-sm leading-relaxed text-ink-2 ${cls}`}>{children}</div>;
}

export function BasisBadge({ basis }: { basis: "forecast" | "calculated" | "heuristic" }) {
  const label = { forecast: "Forecast", calculated: "Calculated", heuristic: "Heuristic" }[basis];
  const cls = basis === "forecast" ? "badge badge-accent" : "badge";
  return <span className={cls}>{label}</span>;
}
