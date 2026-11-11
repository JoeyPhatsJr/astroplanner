import { expect, test, type Page } from "@playwright/test";

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
}

const PAGES = [
  { path: "/how-it-works", headline: "Every number shows its work." },
  { path: "/privacy", headline: "Your pictures stay yours." },
  { path: "/credits", headline: "Built on open science." },
  { path: "/terms", headline: "Plain terms." },
];

for (const { path, headline } of PAGES) {
  test(`${path} renders outside the app shell without errors`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(headline);
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`${path} fits narrow phones and keeps the header link tappable`, async ({ page }) => {
    for (const size of [
      { width: 320, height: 700 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(headline);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} at ${size.width}px`).toBeLessThanOrEqual(0);
      const link = page.getByRole("banner").getByRole("link", { name: "See tonight’s sky" });
      const box = await link.boundingBox();
      expect(box, "header link has a box").not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });
}

test("night vision turns site page text red", async ({ page }) => {
  await page.goto("/privacy");
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
  expect(g).toBeLessThanOrEqual(90); // night ink is #ee5a4b, so g is exactly 90
  expect(b).toBeLessThanOrEqual(90);
});

test("the homescreen footer links to Privacy", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
});

test("the app shell footer links to How it works and Privacy", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "the shell footer is desktop only");
  await page.goto("/settings");
  await page.getByRole("contentinfo").getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/\/how-it-works$/);
  await page.goto("/settings");
  await page.getByRole("contentinfo").getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
});

test("opening a page from the footer starts at its top", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  await page.getByRole("contentinfo").getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(50);
});
