import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { authKey, type Me } from "./auth";
import { ApiError } from "./client";

const isUnauthorized = (e: unknown) => e instanceof ApiError && e.status === 401;

/**
 * The app's query client. Any 401, from a query or a mutation, means the session has ended, so the
 * account query becomes "signed out" and pages show their signed-out screen instead of a raw error.
 * A 401 is never retried: the answer would not change, and a retry only delays that screen.
 */
export function createQueryClient(): QueryClient {
  const onError = (e: unknown) => {
    if (isUnauthorized(e)) qc.setQueryData<Me | null>(authKey, null);
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
