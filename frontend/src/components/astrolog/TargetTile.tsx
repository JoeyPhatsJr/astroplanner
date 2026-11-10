import { Link } from "react-router-dom";
import type { Headline, LibraryRow } from "../../api/astrolog";
import { formatIntegration } from "../../lib/time";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

/** Image URLs from the API are server-relative; honour a configured API base like the fetch client does. */
export function imageSrc(url: string): string {
  return url.startsWith("/") ? `${BASE}${url}` : url;
}

/** "in the final stack" only for the stack linked to the current final picture. */
export function headlineLabel(h: Pick<Headline, "label" | "basis">): string {
  if (h.label === "captured") return "captured";
  return h.basis === "latest" ? "in the latest stack" : "in the final stack";
}

export function nightsLabel(nights: number | null): string {
  return nights === null ? "nights unknown" : `${nights} night${nights === 1 ? "" : "s"}`;
}

export function TargetTile({ row }: { row: LibraryRow }) {
  const { seconds } = row.headline;
  return (
    <Link
      to={`/astrolog/targets/${row.id}`}
      className="panel press group flex flex-col overflow-hidden hover:border-ice/40"
    >
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden border-b border-line bg-ink/5 text-sm text-muted">
        {row.thumb_url ? (
          <img src={imageSrc(row.thumb_url)} alt={`Final picture of ${row.display_name}`} loading="lazy" className="size-full object-cover" />
        ) : (
          <span>No final picture yet</span>
        )}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <span className="truncate font-semibold text-ink">{row.display_name}</span>
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-lg font-semibold tracking-tight text-ice">{formatIntegration(seconds)}</span>
          {seconds !== null && <span className="text-xs text-ink-2">{headlineLabel(row.headline)}</span>}
        </span>
        <span className="text-xs text-muted">{nightsLabel(row.nights)}</span>
      </div>
    </Link>
  );
}
