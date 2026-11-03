import { expect, test, type Page } from "@playwright/test";

// These checks are deliberately tolerant of live weather: a forecast may be available
// or explicitly unavailable, but the page must never show a crash or an invented value.

async function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
}

test("Tonight renders computed night, score state and recommendations", async ({ page }) => {
  const errors = await collectErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Tonight", level: 1 })).toBeVisible();
  await expect(page.getByText("Tonight’s Score").first()).toBeVisible();
  await expect(page.getByText("Heuristic planning estimate").first()).toBeVisible();
  // Either a weather-backed total or an explicit no-weather state, never silence
  await expect(page.getByText(/Components sum to|No score|Forecast unavailable|no weather-backed total/i).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Best targets tonight" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Add .* to session$/ }).first()).toBeVisible();
  await expect(page.getByText(/Open-Meteo/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("Add targets, reorder, reload persists, delete with confirmation", async ({ page }) => {
  await page.goto("/");
  const addButtons = page.getByRole("button", { name: /^Add .* to session$/ });
  await expect(addButtons.first()).toBeVisible();
  const first = (await addButtons.nth(0).getAttribute("aria-label"))!.replace(/^Add (.*) to session$/, "$1");
  const second = (await addButtons.nth(1).getAttribute("aria-label"))!.replace(/^Add (.*) to session$/, "$1");
  await addButtons.nth(0).click();
  await expect(page.getByRole("button", { name: `${first} is in your session` }).first()).toBeVisible();
  await page.getByRole("button", { name: `Add ${second} to session` }).first().click();
  await expect(page.getByRole("button", { name: `${second} is in your session` }).first()).toBeVisible();

  // Manage the session on its AstroLog page (works at every viewport)
  await page.goto("/astrolog/nights");
  await page.getByRole("link", { name: /Night of/ }).first().click();
  const list = page.getByRole("list", { name: "Session targets in order" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByRole("listitem").nth(0)).toContainText(first);

  await page.getByRole("button", { name: `Move ${second} up` }).click();
  await expect(list.getByRole("listitem").nth(0)).toContainText(second);

  await page.reload();
  await expect(list.getByRole("listitem").nth(0)).toContainText(second);
  await expect(list.getByRole("listitem").nth(1)).toContainText(first);

  await page.getByRole("button", { name: `Remove ${first}` }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);

  // Accessible confirm dialog: Cancel keeps the session, Confirm deletes it
  const deleteBtn = page.locator("main").getByRole("button", { name: "Delete", exact: true });
  await deleteBtn.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(list.getByRole("listitem")).toHaveCount(1);

  await deleteBtn.click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete session" }).click();
  await expect(page).toHaveURL(/\/astrolog\/nights$/);
});

test("Explore search opens a target with its altitude chart", async ({ page }) => {
  const errors = await collectErrors(page);
  await page.goto("/explore");
  await page.getByLabel(/Search by name/).fill("whirlpool");
  const results = page.getByRole("list", { name: "Targets" });
  await expect(results.getByText("Whirlpool Galaxy").first()).toBeVisible();
  await results.getByText("Whirlpool Galaxy").first().click();
  await expect(page.getByText("RA (J2000)")).toBeVisible();
  await expect(page.getByText(/Times in America\/New_York/).first()).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();
  expect(errors).toEqual([]);
});

test("Night vision turns the palette red and survives a reload", async ({ page }) => {
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-vision", "normal");
  const ink = () => page.evaluate(() => getComputedStyle(document.body).color);
  const normalInk = await ink();

  const toggle = page.getByRole("button", { name: "Night vision" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(html).toHaveAttribute("data-vision", "night");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // Body text must be red-dominant (no white/blue light): R well above G and B
  const [r, g, b] = (await ink()).match(/\d+/g)!.map(Number);
  expect(r).toBeGreaterThan(150);
  expect(g).toBeLessThan(90);
  expect(b).toBeLessThan(90);
  expect(await ink()).not.toBe(normalInk);

  await page.reload();
  await expect(html).toHaveAttribute("data-vision", "night"); // applied before React via index.html
  await page.getByRole("button", { name: "Night vision" }).click();
  await expect(html).toHaveAttribute("data-vision", "normal");
});

test("Research Lab is an honest preview with no fake controls", async ({ page }) => {
  await page.goto("/research");
  await expect(page.getByText("Preview: Variable Hunter arrives in Phase 3")).toBeVisible();
  const main = page.locator("main");
  await expect(main.getByRole("button")).toHaveCount(0);
  await expect(main.getByRole("textbox")).toHaveCount(0);
});
