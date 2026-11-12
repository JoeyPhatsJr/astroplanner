import { expect, type Page } from "@playwright/test";

// Accounts in e2e: plans, nights and AstroLog belong to a signed-in user, so specs that touch them sign up first.
// Seed data through `page.request`: it shares the page's cookie jar, so the session cookie applies. The bare
// `request` fixture has a cookie jar of its own and stays signed out.

/** The header every state-changing /api/ request must carry (the backend's CSRF guard). */
export const API_HEADERS = { "X-Requested-With": "AstroPlanner" } as const;

/** The password every e2e account uses (the same value as the backend tests' TEST_PASSWORD). */
export const TEST_PASSWORD = "correct horse battery staple";

/**
 * 401s the app expects: signed out, the header's account query asks /api/auth/me; a wrong password gets a 401
 * from /api/auth/login. Chrome logs each as a console error ("Failed to load resource … 401").
 */
const EXPECTED_401 = ["/api/auth/me", "/api/auth/login"];

/**
 * Record uncaught page errors and console errors, except the console error for an expected 401 above
 * (matched on the resource URL Chrome attaches to the message). Read the array at the end of the test.
 */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const url = m.location().url.split("?")[0];
    if (m.text().includes("401") && EXPECTED_401.some((p) => url.endsWith(p))) return;
    errors.push(m.text());
  });
  return errors;
}

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
