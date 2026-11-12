import { expect, type Page } from "@playwright/test";

// Accounts in e2e: plans, nights and AstroLog belong to a signed-in user, so specs that touch them sign up first.
// Seed data through `page.request`: it shares the page's cookie jar, so the session cookie applies. The bare
// `request` fixture has a cookie jar of its own and stays signed out.

/** The header every state-changing /api/ request must carry (the backend's CSRF guard). */
export const API_HEADERS = { "X-Requested-With": "AstroPlanner" } as const;

/** The password every e2e account uses (the same value as the backend tests' TEST_PASSWORD). */
export const TEST_PASSWORD = "correct horse battery staple";

/** A fresh address per call, so every test gets its own empty account. */
export function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@example.com`;
}

/** Create an account and sign this page in (the session cookie lands in the page's context). Returns the email. */
export async function signUp(page: Page, email: string = uniqueEmail()): Promise<string> {
  const r = await page.request.post("/api/auth/signup", {
    headers: API_HEADERS,
    data: { email, password: TEST_PASSWORD },
  });
  expect(r.status(), await r.text()).toBe(201);
  return email;
}
