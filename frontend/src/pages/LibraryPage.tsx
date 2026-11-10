import { Images, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAstroLogLibrary } from "../api/astrolog";
import { TargetTile } from "../components/astrolog/TargetTile";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/States";
import { PageHeader } from "../components/ui/PageHeader";

export function LibraryPage() {
  const lib = useAstroLogLibrary();
  const [filter, setFilter] = useState("all");
  const rows = lib.data ?? [];
  const categories = useMemo(
    () => [...new Set(rows.filter((r) => r.kind !== "unsorted" && r.category).map((r) => r.category as string))].sort(),
    [rows],
  );
  const hasUnsorted = rows.some((r) => r.kind === "unsorted");
  const shown = rows.filter((r) => (filter === "all" ? true : filter === "unsorted" ? r.kind === "unsorted" : r.category === filter && r.kind !== "unsorted"));

  return (
    <div className="page-wide flex flex-col gap-5">
      <PageHeader
        title="AstroLog"
        subtitle="Your astrophotography library, by target."
        actions={
          <div className="flex gap-2">
            <Link to="/astrolog/nights" className="btn">
              Nights
            </Link>
            <Link to="/astrolog/import" className="btn btn-primary">
              <Upload className="size-4" aria-hidden /> Import files
            </Link>
          </div>
        }
      />

      {lib.isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : lib.error ? (
        <ErrorState error={lib.error} onRetry={() => lib.refetch()} title="Couldn't load your library" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Images className="size-6" />}
          title="Your library is empty"
          action={
            <Link to="/astrolog/import" className="btn btn-primary">
              Import files
            </Link>
          }
        >
          Import a folder of Seestar or Canon files and AstroLog will group them by target and night.
        </EmptyState>
      ) : (
        <>
          <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
            {[
              ["all", "All"],
              ...categories.map((c) => [c, c.charAt(0).toUpperCase() + c.slice(1)]),
              ...(hasUnsorted ? [["unsorted", "Unsorted"]] : []),
            ].map(([k, label]) => (
              <button key={k} type="button" className={`btn ${filter === k ? "border-ice/60 text-ice" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4" aria-label="Library targets">
            {shown.map((r) => (
              <li key={r.id} className="contents">
                <TargetTile row={r} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
