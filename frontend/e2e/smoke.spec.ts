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
  // The e2e backend runs with sky images off: targets say so, and the page asks for none.
  const skyRequests: string[] = [];
  page.on("request", (r) => r.url().includes("/sky-image") && skyRequests.push(r.url()));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Tonight", level: 1 })).toBeVisible();
  await expect(page.getByText("Tonight’s Score").first()).toBeVisible();
  await expect(page.getByText(/Heuristic/).first()).toBeVisible();
  // Either a weather-backed total or an explicit no-weather state, never silence
  await expect(page.getByTestId("score-total").or(page.getByTestId("score-no-total"))).toBeVisible();
  await expect(page.getByRole("heading", { name: "Best targets tonight" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Add .* to session$/ }).first()).toBeVisible();
  await expect(page.getByText(/Open-Meteo/).first()).toBeVisible();
  await expect(page.getByText(/Sky images: Digitized Sky Survey/)).toHaveCount(0);
  expect(skyRequests).toEqual([]);
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

test("Phone: tapping outside an open select in the header sheet closes the select, not the sheet", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone layout only");
  await page.goto("/");
  await page.getByRole("button", { name: /·/ }).filter({ has: page.locator("span.truncate") }).click();
  const location = page.getByLabel("Observing location");
  await expect(location).toBeVisible();
  await location.click();
  const popup = page.locator(".pop").first();
  await expect(popup).toBeVisible();
  await expect(page.getByRole("listbox")).toHaveCount(1);
  // A point inside the sheet panel but outside the popup: the modal select's own backdrop covers it.
  const panel = (await page.locator("dialog[open] .overlay-panel").boundingBox())!;
  const pop = (await popup.boundingBox())!;
  const y = pop.y + pop.height + 12 < panel.y + panel.height - 8 ? panel.y + panel.height - 8 : panel.y + 8;
  expect(y < pop.y || y > pop.y + pop.height).toBe(true);
  await page.touchscreen.tap(panel.x + panel.width / 2, y);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  // The sheet's exit takes 200 ms, so a dismissed sheet would still look open at once: wait past it.
  await page.waitForTimeout(500);
  await expect(page.locator("dialog.overlay[open]")).toHaveCount(1);
  await expect(page.locator("dialog.overlay[open]")).toHaveAttribute("data-state", "open");
  await expect(location).toBeVisible();

  // Tapping the scrim itself, with no popup open, still closes the sheet.
  await page.touchscreen.tap(panel.x + panel.width / 2, panel.y / 2);
  await expect(page.locator("dialog.overlay[open]")).toHaveCount(0);
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

test("Night vision: the location and date popups show only red", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Night vision" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-vision", "night");
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: /·/ }).filter({ has: page.locator("span.truncate") }).click();
  }

  // Every visible element in the popup: only red light in text, background, border, focus outline, shadow,
  // or SVG stroke and fill. A colour fails when green or blue exceeds 0.45 x red + 4 (the screenshot check's
  // rule), so white and grey fail too. Each colour is normalised through a canvas, so any CSS colour syntax
  // (rgb(), color(srgb ...), oklch(), exponents) reads as 0-255 channels; one the canvas cannot read fails.
  await page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const SENTINEL = "#010203";
    (window as unknown as { __offends: (c: string) => boolean }).__offends = (c: string) => {
      ctx.fillStyle = SENTINEL;
      ctx.fillStyle = c;
      if (ctx.fillStyle === SENTINEL && c.trim().toLowerCase() !== SENTINEL) return true; // unreadable: not provably red
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return a > 0 && (g > 0.45 * r + 4 || b > 0.45 * r + 4);
    };
  });
  const COLOUR = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\((?:[^()]|\([^()]*\))*\)|#[0-9a-fA-F]{3,8}\b/g;
  // The checker itself must catch white, grey and wide-gamut forms, and pass the night palette's red.
  const selfTest = await page.evaluate((samples) => samples.map((s) => (window as unknown as { __offends: (c: string) => boolean }).__offends(s)), [
    "rgb(255, 255, 255)", "rgb(128, 128, 128)", "color(srgb 1 1 1)", "rgba(200, 0, 0, 0.5)", "rgb(255 60 40)", "color(srgb 1 1e-1 0)", "rgba(0, 0, 0, 0)",
  ]);
  expect(selfTest).toEqual([true, true, true, false, false, false, false]);
  const offenders = () =>
    page.evaluate((colourSource) => {
      const bad: string[] = [];
      const check = (c: string) => (window as unknown as { __offends: (c: string) => boolean }).__offends(c);
      const checkAll = (v: string) => (v.match(new RegExp(colourSource, "g")) ?? []).some(check);
      for (const root of document.querySelectorAll(".pop")) {
        for (const el of [root, ...root.querySelectorAll("*")]) {
          const box = el.getBoundingClientRect();
          if (!box.width || !box.height) continue;
          const cs = getComputedStyle(el);
          const name = `${el.tagName}.${el.getAttribute("class") ?? ""}`;
          if (check(cs.color)) bad.push(`${name} color ${cs.color}`);
          if (check(cs.backgroundColor)) bad.push(`${name} background ${cs.backgroundColor}`);
          for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
            if (parseFloat(cs[`border${side}Width`]) > 0 && check(cs[`border${side}Color`])) bad.push(`${name} border ${cs[`border${side}Color`]}`);
          }
          if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 && check(cs.outlineColor)) bad.push(`${name} outline ${cs.outlineColor}`);
          if (cs.boxShadow !== "none" && checkAll(cs.boxShadow)) bad.push(`${name} shadow ${cs.boxShadow}`);
          if (el instanceof SVGElement) {
            if (cs.stroke !== "none" && checkAll(cs.stroke)) bad.push(`${name} stroke ${cs.stroke}`);
            if (cs.fill !== "none" && checkAll(cs.fill)) bad.push(`${name} fill ${cs.fill}`);
          }
        }
      }
      return bad;
    }, COLOUR.source);

  // Location select: open, focus an option by keyboard (so the focus ring is scanned), then Esc returns focus.
  const location = page.getByLabel("Observing location");
  await location.click();
  const popup = page.locator(".pop").first();
  await expect(popup).toBeVisible();
  await expect(popup.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("ArrowDown");
  expect(await page.evaluate(() => !!document.activeElement?.closest(".pop"))).toBe(true);
  expect(await offenders()).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(location).toBeFocused();

  // Date picker: the grid opens on the chosen night, a day is focused by keyboard, then colours are scanned.
  const night = page.getByLabel("Night date (evening of)");
  const before = (await night.textContent())!.trim();
  await night.click();
  const grid = page.getByRole("grid");
  await expect(grid).toBeVisible();
  await page.keyboard.press("ArrowRight");
  expect(await offenders()).toEqual([]);

  // Days sit under their weekday header: the 1st of the month is in the column of its weekday.
  const cols = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('.pop [role="columnheader"]')].map((h) => {
      const r = h.getBoundingClientRect();
      return { name: h.textContent!, centre: r.left + r.width / 2 };
    });
    const first = document.querySelector<HTMLElement>('.pop [data-date$="-01"]')!;
    const r = first.getBoundingClientRect();
    const weekday = new Date(first.dataset.date + "T00:00:00Z").getUTCDay();
    return { heads, centre: r.left + r.width / 2, expected: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday] };
  });
  const nearest = cols.heads.reduce((a, b) => (Math.abs(b.centre - cols.centre) < Math.abs(a.centre - cols.centre) ? b : a));
  expect(nearest.name).toBe(cols.expected);

  // Esc closes without choosing and returns focus to the trigger.
  await page.keyboard.press("Escape");
  await expect(grid).toHaveCount(0);
  await expect(night).toBeFocused();
  expect((await night.textContent())!.trim()).toBe(before);

  // Enter on a moved day chooses it: the trigger shows the new night, the date is no longer automatic, focus returns.
  await night.click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(grid).toHaveCount(0);
  await expect(night).toBeFocused();
  await expect(night).not.toHaveText(before);
  const tonight = page.getByRole("button", { name: "Tonight", exact: true });
  await expect(tonight).toBeVisible();
  await tonight.click();
  await expect(night).toHaveText(before);
});

test("Themed select works from the keyboard", async ({ page }) => {
  await page.goto("/explore");
  const type = page.getByLabel("Type", { exact: true });
  await expect(type).toHaveText(/All types/);
  await type.focus();
  await page.keyboard.press("ArrowDown"); // opens
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("ArrowDown"); // highlights the next option
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(type).toBeFocused();
  await expect(type).not.toHaveText(/All types/);
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

/** The e2e backend runs with sky images off; pretend the server has them on, as targets would then say. */
async function withSkyImagesOn(page: Page) {
  await page.route(/\/api\/recommendations(\?|$)/, async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    for (const r of json.results) r.target.sky_field_arcmin = 40;
    await route.fulfill({ response: res, json });
  });
}

test("A target card shows its sky image when the survey answers", async ({ page }) => {
  await withSkyImagesOn(page);
  await page.route("**/sky-image", (route) => route.fulfill({ status: 200, contentType: "image/jpeg", body: TINY_JPEG }));
  await page.goto("/");
  // Images load as their cards near the viewport; on a phone the cards start below the fold.
  await page.locator("article").first().scrollIntoViewIfNeeded();
  const img = page.locator("article img[data-loaded]").first();
  await expect(img).toBeAttached();
  await expect(page.getByText(/Sky images: Digitized Sky Survey/)).toBeVisible();
});

test("A target card keeps the framing diagram when the survey is unavailable", async ({ page }) => {
  await withSkyImagesOn(page);
  // A slow survey: each answer takes 300 ms, so the queue's limit of two requests in flight is visible.
  let asked = 0;
  let inFlight = 0;
  let peak = 0;
  await page.route("**/sky-image", async (route) => {
    asked++;
    peak = Math.max(peak, ++inFlight);
    await new Promise((r) => setTimeout(r, 300));
    inFlight--;
    await route.fulfill({ status: 503, body: "unavailable" });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Add .* to session$/ }).first()).toBeVisible();
  await page.locator("article").first().scrollIntoViewIfNeeded();
  await expect.poll(() => asked).toBeGreaterThan(2);
  expect(peak).toBeLessThanOrEqual(2);
  await expect(page.locator("article img")).toHaveCount(0);
  await expect(page.locator("article svg[viewBox='0 0 112 112']").first()).toBeVisible();
});

test("type: digits are tabular only where they align", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("score-total").or(page.getByTestId("score-no-total"))).toBeVisible();
  const bodyFeatures = await page.evaluate(() => getComputedStyle(document.body).fontFeatureSettings);
  expect(bodyFeatures).not.toContain("tnum");
  const score = page.getByTestId("score-total");
  await expect(score).toBeVisible();
  expect(await score.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain("tabular-nums");
  // The strip's hour ticks align too
  const tick = page.locator("svg text").filter({ hasText: /^\d{2}$/ }).first();
  await expect(tick).toBeVisible();
  expect(await tick.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain("tabular-nums");
  const loaded = await page.evaluate(async () => {
    await document.fonts.load('600 40px "Inter Variable"');
    return document.fonts.check('600 40px "Inter Variable"');
  });
  expect(loaded).toBe(true);
});
