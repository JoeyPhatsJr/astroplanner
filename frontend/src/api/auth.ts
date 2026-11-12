import { useMutation, useQuery, useQueryClient, type Query, type QueryClient } from "@tanstack/react-query";
import { ApiError, request } from "./client";

/** The signed-in account, as `/api/auth/me` returns it. The session token itself lives only in an HttpOnly cookie. */
export interface Me {
  email: string;
  created_at: string;
  claimed_existing: boolean;
}

export const authKey = ["auth", "me"] as const;

export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 1024;

/**
 * The client-side length check, before any request (the server enforces the same rule).
 * Counts code points, as the server does, so an emoji is one character.
 */
export function passwordLengthError(pw: string): string | null {
  const n = [...pw].length;
  if (n < MIN_PASSWORD) return `That’s ${n} ${n === 1 ? "character" : "characters"}. Use at least ${MIN_PASSWORD}.`;
  if (n > MAX_PASSWORD) return `Use at most ${MAX_PASSWORD} characters.`;
  return null;
}

const post = (body?: unknown): RequestInit => ({ method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const authApi = {
  /** The signed-in account, or null when signed out (a 401 is an answer here, not an error). */
  me: async (): Promise<Me | null> => {
    try {
      return await request<Me>("/api/auth/me");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    }
  },
  signup: (b: { email: string; password: string }) => request<Me>("/api/auth/signup", post(b)),
  login: (b: { email: string; password: string }) => request<Me>("/api/auth/login", post(b)),
  logout: () => request<void>("/api/auth/logout", post()),
  changePassword: (b: { current_password: string; new_password: string }) =>
    request<void>("/api/auth/password", post(b)),
  deleteAccount: (b: { password: string; confirm: "DELETE" }) => request<void>("/api/auth/delete", post(b)),
};

const notAuth = (q: Query) => q.queryKey[0] !== "auth";

/**
 * Query-key roots of data that belongs to the signed-in account (plans and nights, AstroLog, the Processing
 * Coach). Everything else is open: places, equipment, Tonight, Explore and Variable Hunter keep working signed out.
 */
export const OWNED_QUERY_ROOTS: ReadonlySet<unknown> = new Set(["sessions", "astrolog", "processing-run"]);
/** Open routes that add the signed-in user's own progress to their answer (Variable Hunter). */
export const PERSONAL_OPEN_QUERY_ROOTS: ReadonlySet<unknown> = new Set(["variables"]);
const isOwned = (q: Query) => OWNED_QUERY_ROOTS.has(q.queryKey[0]);

/**
 * Switch the cache to another account (or to signed out), so no data from the previous user stays visible.
 *
 * - Signed in: every other query resets, and the ones on screen refetch with the new account's cookie.
 * - Signed out: nothing owned is requested again. Owned queries on screen are emptied in place (their
 *   observers keep the same query object, so a re-render does not refetch); owned queries off screen are
 *   dropped. Variable Hunter resets and refetches without the personal progress. Shared data (places,
 *   equipment, Tonight, Explore) is the same for everyone, so it stays on screen untouched.
 *
 * Resolves once the cache has switched; the auth mutations return it, so they stay pending until then.
 */
export async function applyAuth(qc: QueryClient, me: Me | null): Promise<void> {
  // A /me request sent before this change could land after it and overwrite the new answer.
  await qc.cancelQueries({ queryKey: authKey });
  qc.setQueryData<Me | null>(authKey, me);
  if (me) {
    void qc.resetQueries({ predicate: notAuth });
    return;
  }
  const cache = qc.getQueryCache();
  for (const q of cache.findAll({ predicate: isOwned })) {
    if (q.getObserversCount() > 0) q.reset(); // cancels any fetch in flight and clears the data
    else cache.remove(q);
  }
  void qc.resetQueries({ predicate: (q) => PERSONAL_OPEN_QUERY_ROOTS.has(q.queryKey[0]) });
}

export function useMe() {
  return useQuery({ queryKey: authKey, queryFn: authApi.me, retry: false, staleTime: 5 * 60_000 });
}

export type AuthStatus = "loading" | "signedIn" | "signedOut";

/** "signedOut" also covers a failed /me request (backend down): nothing owned can load then either. */
export function useAuthStatus(): AuthStatus {
  const q = useMe();
  if (q.data !== undefined) return q.data ? "signedIn" : "signedOut";
  return q.isError ? "signedOut" : "loading";
}

export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: authApi.login, onSuccess: (me) => applyAuth(qc, me) });
}

export function useSignUp() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: authApi.signup, onSuccess: (me) => applyAuth(qc, me) });
}

/** `onSignedOut` runs before the cache flips to signed out, so a page can navigate away first. */
export function useSignOut(opts: { onSignedOut?: () => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      opts.onSignedOut?.();
      return applyAuth(qc, null);
    },
  });
}

export function useChangePassword() {
  return useMutation({ mutationFn: authApi.changePassword });
}

/** `onDeleted` runs before the cache flips to signed out, so the page can navigate away first. */
export function useDeleteAccount(opts: { onDeleted?: () => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: authApi.deleteAccount,
    onSuccess: () => {
      opts.onDeleted?.();
      return applyAuth(qc, null);
    },
  });
}
