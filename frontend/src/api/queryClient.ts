import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { clearImportStash } from "../lib/importStash";
import { authKey, PERSONAL_OPEN_QUERY_ROOTS, type Me } from "./auth";
import { ApiError } from "./client";

const isUnauthorized = (e: unknown) => e instanceof ApiError && e.status === 401;

/**
 * A 401 means the session has ended: mark the account signed out, so pages show their signed-out screen
 * instead of a raw error. The AstroLog import's stashed files are dropped. Personal progress on open pages
 * (Variable Hunter) is reset and refetched, so the previous answer with the user's own counts does not stay on
 * screen. Returns true when `e` was a 401.
 *
 * TanStack queries and mutations go through this on their own (see `createQueryClient`); direct API calls
 * (the AstroLog import, script downloads) call it in their `catch` and stop there when it returns true.
 */
export function markSignedOutIf401(qc: QueryClient, e: unknown): boolean {
  if (!isUnauthorized(e)) return false;
  const wasSignedIn = !!qc.getQueryData<Me | null>(authKey);
  qc.setQueryData<Me | null>(authKey, null);
  clearImportStash(); // the AstroLog import's stashed files belonged to the session that ended
  // Only when a session just ended: a wrong password while signed out has no personal data to clear.
  if (wasSignedIn) void qc.resetQueries({ predicate: (q) => PERSONAL_OPEN_QUERY_ROOTS.has(q.queryKey[0]) });
  return true;
}

/**
 * The app's query client. Any 401, from a query or a mutation, means the session has ended, so the
 * account query becomes "signed out" and pages show their signed-out screen instead of a raw error.
 * A 401 is never retried: the answer would not change, and a retry only delays that screen.
 */
export function createQueryClient(): QueryClient {
  const onError = (e: unknown) => {
    markSignedOutIf401(qc, e);
  };
  const qc = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        retry: (failures, e) => !isUnauthorized(e) && failures < 1,
        refetchOnWindowFocus: false,
      },
    },
  });
  return qc;
}
