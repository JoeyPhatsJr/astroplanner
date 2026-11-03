import { ListOrdered } from "lucide-react";
import { Link } from "react-router-dom";
import { useCurrentLocation, useNightDate } from "../../api/hooks";
import { nightLabel } from "../../lib/time";
import { useActiveSession } from "../../state/activeSession";
import { ErrorState, Notice, Skeleton } from "../ui/States";
import { SessionTargetList } from "./SessionTargetList";

export function SessionPlanPanel() {
  const { session, sessionsQuery, mutations: m, error } = useActiveSession();
  const { nightDate } = useNightDate();
  const { location } = useCurrentLocation();
  const busy = m.reorder.isPending || m.removeTarget.isPending;

  return (
    <section className="panel flex flex-col gap-4 p-5" aria-labelledby="plan-heading">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="plan-heading" className="font-semibold tracking-tight text-xl">
          Session plan
        </h2>
        <Link to={session ? `/astrolog/nights/${session.id}` : "/astrolog"} className="text-sm text-ice hover:underline">
          {session ? "Open session" : "All sessions"}
        </Link>
      </div>
      {error && <Notice tone="warn">{error}</Notice>}
      {sessionsQuery.isLoading && <Skeleton className="h-24 w-full" />}
      {sessionsQuery.error && <ErrorState error={sessionsQuery.error} onRetry={() => sessionsQuery.refetch()} />}
      {!sessionsQuery.isLoading && !sessionsQuery.error && (
        <>
          {session ? (
            <>
              <p className="text-sm text-ink-2">
                <span className="text-ink">{session.title}</span>
                {nightDate ? <span className="block text-xs text-muted">{nightLabel(nightDate)}</span> : null}
              </p>
              {session.targets.length ? (
                <SessionTargetList
                  targets={session.targets}
                  tz={location?.timezone ?? null}
                  busy={busy}
                  onReorder={(ids) => m.reorder.mutate({ id: session.id, ids })}
                  onRemove={(stId) => m.removeTarget.mutate({ id: session.id, stId })}
                />
              ) : (
                <p className="text-sm text-muted">No targets yet. Use “Add to session” on a target.</p>
              )}
              <p className="text-xs text-muted">Changes save automatically.</p>
            </>
          ) : (
            <div className="flex flex-col items-start gap-2 text-sm text-ink-2">
              <ListOrdered className="size-5 text-ice" aria-hidden />
              <p>No plan for this night yet. Adding a target creates one and saves it.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
