import { expect, test, type Page } from "@playwright/test";

// These checks are deliberately tolerant of live weather: a forecast may be available
// or explicitly unavailable, but the page must never show a crash or an invented value.

async function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // A survey image that cannot load is a handled state (the diagram stays); the browser still logs its 503.
  page.on("console", (m) => m.type() === "error" && !m.location().url.includes("/sky-image") && errors.push(m.text()));
  return errors;
}

test("Tonight renders computed night, score state and recommendations", async ({ page }) => {
  const errors = await collectErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Tonight", level: 1 })).toBeVisible();
  await expect(page.getByText("Tonight’s Score").first()).toBeVisible();
  await expect(page.getByText(/Heuristic/).first()).toBeVisible();
  // Either a weather-backed total or an explicit no-weather state, never silence
  await expect(page.getByTestId("score-total").or(page.getByTestId("score-no-total"))).toBeVisible();
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

test("Phone: one-row header chip opens the controls sheet; details is a bottom sheet that drags closed", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone layout only");
  await page.goto("/");
  const chip = page.getByRole("button", { name: /·/ }).filter({ has: page.locator("span.truncate") });
  await expect(chip).toBeVisible();
  const header = page.getByRole("banner");
  expect((await header.boundingBox())!.height).toBeLessThan(72);
  await chip.click();
  await expect(page.getByLabel("Observing location")).toBeVisible();
  await expect(page.getByLabel("Equipment profile")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByLabel("Observing location")).toBeHidden();

  await page.goto("/explore");
  await page.getByLabel(/Search by name/).fill("whirlpool");
  await page.getByRole("list", { name: "Targets" }).getByText("Whirlpool Galaxy").first().click();
  const panel = page.locator("dialog[open] .overlay-panel");
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  const vh = page.viewportSize()!.height;
  expect(box.width).toBeGreaterThan(page.viewportSize()!.width - 2);
  expect(box.height / vh).toBeGreaterThan(0.8);
  // drag the grabber well past the threshold with real pointer events
  // The whole sticky top (grabber + title row) is the drag region; start on the title text, not a button.
  const top = page.locator("dialog[open] .sheet-top");
  expect((await top.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const title = (await page.locator("#target-detail-title").boundingBox())!;
  await page.mouse.move(title.x + 20, title.y + title.height / 2);
  await page.mouse.down();
  // Past 35% of the sheet height so the distance path decides (not velocity).
  await page.mouse.move(title.x + 20, title.y + title.height / 2 + box.height * 0.5, { steps: 12 });
  // Hold still before lifting: an idle finger carries no flick velocity.
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
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

test("Variable Hunter route has no fake controls", async ({ page }) => {
  await page.goto("/research");
  await expect(page.getByRole("heading", { name: "Variable Hunter" })).toBeVisible();
  const main = page.locator("main");
  await expect(main.getByRole("button")).toHaveCount(0);
  await expect(main.getByRole("textbox")).toHaveCount(0);
});

// 1x1 JPEG, so the card has a real image to show.
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

test("A target card shows its sky image when the survey answers", async ({ page }) => {
  await page.route("**/sky-image", (route) => route.fulfill({ status: 200, contentType: "image/jpeg", body: TINY_JPEG }));
  await page.goto("/");
  const img = page.locator("article img[data-loaded]").first();
  await expect(img).toBeAttached();
  await expect(page.getByText(/Sky images: Digitized Sky Survey/)).toBeVisible();
});

test("A target card keeps the framing diagram when the survey is unavailable", async ({ page }) => {
  await page.route("**/sky-image", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Add .* to session$/ }).first()).toBeVisible();
  await expect(page.locator("article img")).toHaveCount(0);
  await expect(page.locator("article svg[viewBox='0 0 112 112']").first()).toBeVisible();
});
