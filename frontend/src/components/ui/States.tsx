import { AlertTriangle, RotateCw } from "lucide-react";
import type { ReactNode } from "react";

export function Skeleton({ className = "", label = "Loading" }: { className?: string; label?: string }) {
  return <div className={`skeleton ${className}`} role="status" aria-label={label} />;
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
      <p className="font-serif text-xl text-ink">{title}</p>
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
  const tone =
    basis === "forecast" ? "border-ice/40 text-ice" : basis === "calculated" ? "border-line text-ink-2" : "border-gold/40 text-gold";
  return <span className={`badge ${tone}`}>{label}</span>;
}
