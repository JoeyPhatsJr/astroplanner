import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { clearImportStash } from "../lib/importStash";
import { authKey, PERSONAL_OPEN_QUERY_ROOTS, type Me } from "./auth";
import { ApiError } from "./client";

const isUnauthorized = (e: unknown) => e instanceof ApiError && e.status === 401;

/** Answers that usually clear up on their own: no response, rate limited, or the host waking up or busy. */
const TRANSIENT = new Set([0, 429, 502, 503, 504]);
const isTransient = (e: unknown) => e instanceof ApiError && TRANSIENT.has(e.status);
/** Waits before each retry of a transient failure; a free host can take a while to wake or lift a rate limit. */
export const TRANSIENT_RETRY_DELAYS_MS = [1_000, 3_000, 8_000];

/** Retry a 401 never, a transient failure up to three times, anything else once. */
export function shouldRetry(failures: number, e: unknown): boolean {
  if (isUnauthorized(e)) return false;
  return failures < (isTransient(e) ? TRANSIENT_RETRY_DELAYS_MS.length : 1);
}

export function retryDelay(attempt: number, e: unknown): number {
  if (isTransient(e)) return TRANSIENT_RETRY_DELAYS_MS[Math.min(attempt, TRANSIENT_RETRY_DELAYS_MS.length - 1)];
  return Math.min(1_000 * 2 ** attempt, 30_000);
}

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
 * A 401 is never retried: the answer would not change, and a retry only delays that screen. Transient
 * failures (429 and 502-504 from the hosting layer, or no response) are retried with longer waits.
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
        retry: shouldRetry,
        retryDelay,
        refetchOnWindowFocus: false,
      },
    },
  });
  return qc;
}
