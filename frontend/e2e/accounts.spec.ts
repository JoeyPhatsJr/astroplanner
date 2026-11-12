import { expect, test, type Page } from "@playwright/test";
import { API_HEADERS, collectErrors, signUp, TEST_PASSWORD, uniqueEmail } from "./auth";

// Accounts end to end, against the real backend: create, sign out, sign in, return-to, the cookie, isolation
// between two people, delete, and what a signed-out visitor's browser asks for.

const SIGN_IN_FAILED = "That email and password don’t match. Check them, or reset your password.";
const GATE = "Your nights live in your account.";
const RESET_COMMAND = "cd backend && .venv/bin/python -m app.accounts reset-password you@example.com";

async function signInThroughForm(page: Page, email: string, password = TEST_PASSWORD) {
  const form = page.getByRole("form", { name: "Sign in" });
  await form.getByLabel("Email", { exact: true }).fill(email);
  await form.getByLabel("Password", { exact: true }).fill(password);
  await form.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("create account, open AstroLog, sign out, see the gate, sign in again", async ({ page }) => {
  const errors = collectErrors(page);
  const email = uniqueEmail();
  await page.goto("/signup");
  const form = page.getByRole("form", { name: "Create account" });
  await form.getByLabel("Email", { exact: true }).fill(email);
  await form.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/astrolog$/);
  await expect(page.getByRole("heading", { level: 1, name: "AstroLog" })).toBeVisible();

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("navigation", { name: "Account" }).getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: GATE })).toBeVisible();
  await expect(page).toHaveURL(/\/astrolog$/);

  await page.getByRole("main").getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fastrolog$/);
  await signInThroughForm(page, email);
  await expect(page).toHaveURL(/\/astrolog$/);
  await expect(page.getByRole("heading", { level: 1, name: "AstroLog" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("return-to after sign-in", async ({ page }) => {
  const errors = collectErrors(page);
  const email = await signUp(page);
  await page.context().clearCookies();
  await page.goto("/astrolog/import");
  await expect(page.getByRole("heading", { level: 1, name: GATE })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fastrolog%2Fimport$/);
  await signInThroughForm(page, email);
  await expect(page).toHaveURL(/\/astrolog\/import$/);
  expect(errors).toEqual([]);
});

test("wrong password reads the generic message", async ({ page }) => {
  const errors = collectErrors(page);
  const email = await signUp(page);
  await page.context().clearCookies();
  await page.goto("/login");
  await signInThroughForm(page, email, "not the right password");
  await expect(page.getByRole("alert")).toHaveText(SIGN_IN_FAILED);
  // An address with no account reads exactly the same.
  await signInThroughForm(page, uniqueEmail(), "not the right password");
  await expect(page.getByRole("alert")).toHaveText(SIGN_IN_FAILED);
  expect(errors).toEqual([]);
});

test("token stays in an HttpOnly cookie", async ({ page }) => {
  const errors = collectErrors(page);
  const email = await signUp(page);
  await page.context().clearCookies();
  await page.goto("/login");
  await signInThroughForm(page, email);
  await expect(page).toHaveURL(/\/astrolog$/);
  await expect(page.getByRole("heading", { level: 1, name: "AstroLog" })).toBeVisible();

  const cookie = (await page.context().cookies()).find((c) => c.name === "astroplanner_session");
  expect(cookie, "the session cookie is set").toBeDefined();
  expect(cookie!.value.length).toBeGreaterThan(20);
  expect(cookie!.httpOnly).toBe(true);
  expect(cookie!.sameSite).toBe("Lax");
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain(cookie!.value);
  expect(page.url()).not.toContain(cookie!.value);
  // Scripts on the page cannot read it either.
  expect(await page.evaluate(() => document.cookie)).not.toContain(cookie!.value);
  expect(errors).toEqual([]);
});

test("one user cannot see another's plan", async ({ page, browser }) => {
  const errors = collectErrors(page);
  await signUp(page);
  const title = `A’s plan ${Date.now()}`;
  const made = await page.request.post("/api/sessions", {
    headers: API_HEADERS,
    data: { title, local_night_date: "2026-11-11" },
  });
  expect(made.status(), await made.text()).toBe(201);
  // Positive control: A sees her own plan on the Nights page.
  await page.goto("/astrolog/nights");
  await expect(page.getByRole("main").getByText(title)).toBeVisible();

  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const pageB = await other.newPage();
  const errorsB = collectErrors(pageB);
  await signUp(pageB);
  await pageB.goto("/astrolog/nights");
  await expect(pageB.getByRole("heading", { level: 1, name: "Nights" })).toBeVisible();
  await expect(pageB.getByText("No saved sessions yet")).toBeVisible();
  await expect(pageB.getByText(title)).toHaveCount(0);
  // And not through the API.
  const id = (await made.json()).id as string;
  expect((await pageB.request.get(`/api/sessions/${id}`)).status()).toBe(404);
  await other.close();
  expect(errors).toEqual([]);
  expect(errorsB).toEqual([]);
});

test("delete account", async ({ page }) => {
  const errors = collectErrors(page);
  const email = await signUp(page);
  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
  await expect(page.getByRole("main").getByText(email)).toBeVisible();

  const trigger = page.getByRole("button", { name: "Delete account…" });
  // Escape closes it and gives focus back to the button that opened it.
  await trigger.click();
  const dialog = page.getByRole("alertdialog", { name: "Delete your account?" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(dialog).toBeVisible();
  const del = dialog.getByRole("button", { name: "Delete account", exact: true });
  await expect(del).toBeDisabled();
  await dialog.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
  await expect(del).toBeEnabled();
  await del.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true })).toBeVisible();

  await page.goto("/astrolog");
  await expect(page.getByRole("heading", { level: 1, name: GATE })).toBeVisible();

  await page.goto("/login");
  await signInThroughForm(page, email);
  await expect(page.getByRole("alert")).toHaveText(SIGN_IN_FAILED);
  expect(errors).toEqual([]);
});

test("signed out, open pages request nothing owned", async ({ page }) => {
  const errors = collectErrors(page);
  const api: string[] = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/api/")) api.push(path);
  });
  await page.goto("/tonight");
  await expect(page.getByRole("heading", { name: "Tonight", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to plan" })).toBeVisible();

  await page.goto("/explore");
  const results = page.getByRole("list", { name: "Targets" });
  await expect(results.getByText("Whirlpool Galaxy").first()).toBeVisible();
  await results.getByText("Whirlpool Galaxy").first().click();
  await expect(page.getByText("RA (J2000)")).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();

  await page.goto("/variables/ss-cyg");
  await expect(page.getByRole("heading", { name: "SS Cyg", level: 1 })).toBeVisible();

  expect(api.length, "the pages asked the API for something").toBeGreaterThan(0);
  const owned = api.filter((p) => ["/api/sessions", "/api/astrolog", "/api/processing"].some((root) => p.startsWith(root)));
  expect(owned).toEqual([]);
  expect(errors).toEqual([]);
});

test("forgot password shows the terminal command", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/login\/reset-help$/);
  await expect(page.getByText(RESET_COMMAND)).toBeVisible();
  expect(errors).toEqual([]);
});

test("header at 320 px", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "sets its own 320 px viewport");
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 320, height: 700 });

  const fits = async (where: string) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${where}: no sideways scroll`).toBeLessThanOrEqual(0);
  };
  const inside = async (where: string, box: { x: number; y: number; width: number; height: number } | null) => {
    expect(box, `${where}: has a box`).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(box!.height, `${where}: 44 px target`).toBeGreaterThanOrEqual(44);
  };
  const slotAndPill = async (where: string, slotName: "Sign in" | "Account menu") => {
    const banner = page.getByRole("banner");
    const slot = slotName === "Sign in" ? banner.getByRole("link", { name: "Sign in", exact: true }) : banner.getByRole("button", { name: "Account menu" });
    const pill = banner.getByRole("link", { name: "See tonight’s sky" });
    await expect(slot).toBeVisible();
    const [s, p] = [await slot.boundingBox(), await pill.boundingBox()];
    await inside(`${where} slot`, s);
    await inside(`${where} pill`, p);
    expect(Math.abs(s!.y - p!.y), `${where}: one row`).toBeLessThanOrEqual(4);
    await fits(where);
  };

  for (const path of ["/", "/privacy"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await slotAndPill(`${path} signed out`, "Sign in");
  }

  await signUp(page);
  await page.goto("/");
  await slotAndPill("/ signed in", "Account menu");

  // The app shell has no pill; its top bar holds the header controls and the account button.
  await page.goto("/tonight");
  await expect(page.getByRole("heading", { name: "Tonight", level: 1 })).toBeVisible();
  await inside("/tonight account button", await page.getByRole("button", { name: "Account menu" }).boundingBox());
  await fits("/tonight signed in");
  expect(errors).toEqual([]);
});

test("night vision on sign in", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/login");
  await page.evaluate(() => {
    const k = "astroplanner.prefs.v1";
    const p = JSON.parse(localStorage.getItem(k) ?? "{}");
    localStorage.setItem(k, JSON.stringify({ ...p, nightVision: true }));
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-vision", "night");
  const color = await page.evaluate(() => getComputedStyle(document.body).color);
  const [r, g, b] = color.match(/\d+/g)!.map(Number);
  expect(r).toBeGreaterThan(150);
  expect(g).toBeLessThanOrEqual(90); // night ink is #ee5a4b, so g is exactly 90 (as site.spec.ts)
  expect(b).toBeLessThanOrEqual(90);
  expect(errors).toEqual([]);
});
