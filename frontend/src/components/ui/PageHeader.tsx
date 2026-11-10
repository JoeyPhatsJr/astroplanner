import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/** The one page heading: optional back link, the h1, a subtitle and right-aligned actions. */
export function PageHeader({
  title,
  subtitle,
  back,
  actions,
  notice,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
  /** A plain sentence under the subtitle, for a standing fact about the page such as the sample location. */
  notice?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-1">
      {back && (
        <Link to={back.to} className="press inline-flex items-center gap-1.5 self-start text-sm text-ice hover:underline">
          <ArrowLeft className="size-4" aria-hidden /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold text-ink md:text-display">{title}</h1>
          {subtitle && <div className="mt-1 max-w-prose text-sm text-ink-2">{subtitle}</div>}
          {notice && <p className="mt-2 text-sm text-ink-2">{notice}</p>}
        </div>
        {actions}
      </div>
    </header>
  );
}
