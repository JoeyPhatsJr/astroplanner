import type { QueryClient } from "@tanstack/react-query";
import { authKey, type Me } from "../api/auth";

/** The account tests sign in as. */
export const TEST_ME: Me = { email: "owner@example.com", created_at: "2026-11-11T12:00:00Z", claimed_existing: false };

/** Signed in as `me`. Fresh for `useMe`'s stale time, so no /api/auth/me request is made. */
export function seedSignedIn(qc: QueryClient, me: Me = TEST_ME): void {
  qc.setQueryData<Me | null>(authKey, me);
}

/** Signed out, without a /api/auth/me request. */
export function seedSignedOut(qc: QueryClient): void {
  qc.setQueryData<Me | null>(authKey, null);
}

/**
 * For fetch stubs that answer only the routes a test names: a signed-out answer to GET /api/auth/me,
 * which every page with the header slot asks. Returns undefined for any other request.
 */
export function signedOutMe(url: string, init?: RequestInit): Response | undefined {
  if ((init?.method ?? "GET") !== "GET" || url.split("?")[0] !== "/api/auth/me") return undefined;
  return new Response(JSON.stringify({ detail: "Sign in to continue." }), { status: 401 });
}
