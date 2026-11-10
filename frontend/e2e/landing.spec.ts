import { expect, test, type Page } from "@playwright/test";

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
}

test("landing page tells the story first, with real pictures, and hands off to Tonight", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");

  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toHaveText("One night. One picture. Everything in between.");
  // Landing renders outside the app shell
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);

  // Header first, then the photo: the headline sits above the hero image on screen
  const photo = page.getByAltText(/The Andromeda Galaxy/);
  await expect(photo).toBeVisible();
  const [h1Box, photoBox] = [await h1.boundingBox(), await photo.boundingBox()];
  expect(h1Box!.y).toBeLessThan(photoBox!.y);

  // Every image actually loads (no broken pictures)
  for (const img of await page.locator("main img").all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }

  // No horizontal scrolling at any viewport
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // The hero's call to action (the header and the first chapter use the same label for the same place)
  await page.getByRole("main").getByRole("link", { name: "See tonight’s sky" }).first().click();
  await expect(page).toHaveURL(/\/tonight$/);
  await expect(page.getByRole("heading", { name: "Tonight", level: 1 })).toBeVisible();

  // The app shell's wordmark goes back home
  await page.getByRole("link", { name: "AstroPlanner home" }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(h1).toBeVisible();
  expect(errors).toEqual([]);
});

test("the story clock follows the scroll and starts over at the top", async ({ page }) => {
  await page.goto("/");
  const clock = page.locator(".landing-clock-time");
  await expect(clock).toHaveText("16:57");
  await page.locator('[data-chapter="astrolog"]').evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect(clock).toHaveText("06:32");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(clock).toHaveText("Next");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(clock).toHaveText("16:57");
});

test("night vision turns the landing pictures red only", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const k = "astroplanner.prefs.v1";
    const p = JSON.parse(localStorage.getItem(k) ?? "{}");
    localStorage.setItem(k, JSON.stringify({ ...p, nightVision: true }));
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-vision", "night");
  const frame = page.locator(".landing-hero-photo");
  // Greyscale picture multiplied by the accent red: no yellow-green cores, no white or blue light
  expect(await frame.locator("img").evaluate((el) => getComputedStyle(el).filter)).toContain("grayscale(1)");
  const tint = await frame.evaluate((el) => {
    const s = getComputedStyle(el, "::after");
    return { blend: s.mixBlendMode, bg: s.backgroundColor };
  });
  expect(tint.blend).toBe("multiply");
  const [r, g, b] = tint.bg.match(/\d+/g)!.map(Number);
  expect(r).toBeGreaterThan(3 * Math.max(g, b));
});

test("city box opens Tonight for the chosen place (live geocoding, tolerated when offline)", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your city").fill("Denver");
  await page.getByRole("button", { name: /Find out/ }).click();

  const firstPlace = page.getByRole("list", { name: /Places matching Denver/ }).getByRole("button").first();
  const failed = page.getByText(/Couldn’t reach the place search/);
  await expect(firstPlace.or(failed)).toBeVisible();
  test.skip(await failed.isVisible(), "Open-Meteo geocoding unreachable from this machine");

  await firstPlace.click();
  await expect(page).toHaveURL(/\/tonight$/);
  await expect(page.getByRole("heading", { name: "Tonight", level: 1 })).toBeVisible();
  // Tonight's subtitle names the chosen place ("… at Denver, Colorado, …")
  await expect(page.locator("main").getByText(/Denver/).first()).toBeVisible();

  // Choosing the same place again reuses the saved location rather than adding a duplicate
  await page.goto("/");
  await page.getByLabel("Your city").fill("Denver");
  await page.getByRole("button", { name: /Find out/ }).click();
  await page.getByRole("list", { name: /Places matching Denver/ }).getByRole("button").first().click();
  await expect(page).toHaveURL(/\/tonight$/);
  const denvers = await page.evaluate(async () => {
    const r = await fetch("/api/locations");
    const list = (await r.json()) as { label: string }[];
    return list.filter((l) => l.label.includes("Denver")).length;
  });
  expect(denvers).toBe(1);
});
