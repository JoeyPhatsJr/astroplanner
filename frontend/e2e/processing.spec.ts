import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// Processing Coach end to end on a SYNTHETIC night (backend/scripts/make_synthetic_night.py): dummy coordinates,
// header-only FITS lights and Siril-style text files, no real data and no absolute paths. The desktop and mobile
// projects share one database, so each imports a different object on a different night.

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, "..", "..", "backend");

const PER_PROJECT = {
  desktop: { object: "NGC 7000", start: "2026-10-04T03:00:00", lat: 42.0, lon: -77.0 },
  mobile: { object: "IC 1805", start: "2026-10-06T03:00:00", lat: 43.0, lon: -78.0 },
} as const;

test("import a synthetic night, read its Siril folder, choose frames, download both scripts, open Compare", async ({ page, request }, testInfo) => {
  const cfg = PER_PROJECT[testInfo.project.name as keyof typeof PER_PROJECT];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  const nightDir = join(HERE, "fixtures", `synthetic-night-${testInfo.project.name}`);
  execFileSync(
    join(BACKEND, ".venv", "bin", "python"),
    [join(BACKEND, "scripts", "make_synthetic_night.py"), nightDir, "--object", cfg.object, "--start", cfg.start, "--lat", String(cfg.lat), "--lon", String(cfg.lon)],
    { cwd: BACKEND },
  );

  const loc = await request.post("/api/locations", {
    headers: { "X-Requested-With": "AstroPlanner" },
    data: { label: `E2E coach ${testInfo.project.name}`, latitude_deg: cfg.lat, longitude_deg: cfg.lon, timezone: "America/New_York" },
  });
  expect(loc.ok()).toBeTruthy();

  // AstroLog import of the lights; process/ is ignored by the importer.
  await page.goto("/astrolog/import");
  await page.locator("#astrolog-folder").setInputFiles(nightDir);
  await expect(page.getByRole("heading", { name: "Review", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: /^Import 40 new frames$/ }).click();
  await expect(page).toHaveURL(/\/astrolog\/targets\//);

  // Open the coach for that night.
  await page.getByRole("link", { name: /^Process this night/ }).click();
  await expect(page).toHaveURL(/\/astrolog\/process\//);
  await expect(page.getByRole("heading", { name: "Processing coach", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Night report", level: 2 })).toBeVisible();

  // Pick the whole night folder: only the .seq / *_conversion.txt files are read.
  await page.locator("#coach-folder").setInputFiles(nightDir);
  const totals = page.getByRole("group", { name: "Night totals" });
  await expect(totals).toContainText("Frames captured");
  await expect(totals.getByText("40", { exact: true })).toBeVisible();
  await expect(totals.getByText("34", { exact: true })).toBeVisible();
  await expect(totals.getByText("26", { exact: true })).toBeVisible();
  await expect(page.getByText(/had roundness below/).first()).toBeVisible();
  await expect(page.getByText(/6 frames couldn't be aligned/)).toBeVisible();

  // Step 5 before any choice: the stack script is blocked, with its reason visible next to the button.
  await page.getByRole("button", { name: /^5 · Stack$/ }).click();
  const stackBtn = page.getByRole("button", { name: "Download script 2 (stack)" });
  await expect(stackBtn).toBeDisabled();
  await expect(page.getByText("Choose which frames to keep first.")).toBeVisible();
  await expect(stackBtn).toHaveAccessibleDescription("Choose which frames to keep first.");

  // Step 4: choose, then both scripts download with their names. The synthetic counts come from process/, so the
  // step says script 2 (which works in process-coach/) may count differently.
  await page.getByRole("button", { name: /^4 · Choose frames$/ }).click();
  await expect(page.getByRole("note").filter({ hasText: "These counts are from process/." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose frames", level: 2 })).toBeVisible();
  const radios = page.getByRole("radio", { name: /frames/ });
  await expect(radios.first()).toBeVisible();
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0); // nothing is chosen for you
  await page.getByRole("radio").first().click(); // controlled: the saved choice comes back from the server
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(1);

  await page.getByRole("button", { name: /^5 · Stack$/ }).click();
  await expect(page.getByText(/^Your choice from step 4:/)).toBeVisible();
  const [stackDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download script 2 (stack)" }).click()]);
  expect(stackDl.suggestedFilename()).toBe("astroplanner-stack.ssf");
  const stackText = readFileSync(await stackDl.path(), "utf8");
  expect(stackText).toContain("requires 1.4.5");
  expect(stackText).toContain("# These counts are from process/.");

  await page.getByRole("button", { name: /^2 · Convert & debayer$/ }).click();
  const [prepDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download script 1 (prepare)" }).click()]);
  expect(prepDl.suggestedFilename()).toBe("astroplanner-prepare.ssf");
  expect(readFileSync(await prepDl.path(), "utf8")).toContain("requires 1.4.5");

  // Compare: nothing has been added, so each side says so and offers to add one.
  await page.getByRole("button", { name: /^10 · Compare$/ }).click();
  await expect(page.getByRole("heading", { name: "Compare", level: 2 })).toBeVisible();
  await expect(page.getByText("No Seestar picture yet.")).toBeVisible();
  await expect(page.getByText("No final picture yet.").first()).toBeVisible();

  expect(errors).toEqual([]);
});
