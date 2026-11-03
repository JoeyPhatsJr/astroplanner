import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// Synthetic FITS headers only: dummy coordinates (40/-75 desktop, 41/-76 mobile), no real data anywhere.

function card(key: string, value: string | number | boolean): string {
  let v: string;
  if (typeof value === "boolean") v = (value ? "T" : "F").padStart(20);
  else if (typeof value === "number") v = String(value).padStart(20);
  else v = `'${value}'`.padEnd(20);
  return `${key.padEnd(8)}= ${v}`.padEnd(80).slice(0, 80);
}

function fitsFile(cards: Record<string, string | number | boolean>): Buffer {
  const text = Object.entries(cards).map(([k, v]) => card(k, v)).join("") + "END".padEnd(80);
  const padded = text.padEnd(Math.ceil(text.length / 2880) * 2880);
  return Buffer.concat([Buffer.from(padded, "ascii"), Buffer.alloc(2880)]); // header + one small data block
}

function base(object: string, dateObs: string, lat: number, lon: number) {
  return {
    SIMPLE: true,
    BITPIX: 16,
    NAXIS: 2,
    NAXIS1: 1080,
    NAXIS2: 1920,
    CREATOR: "ZWO Seestar S30",
    INSTRUME: "Seestar S30",
    TELESCOP: "S30_00000000",
    IMAGETYP: "Light",
    OBJECT: object,
    RA: 349.0,
    DEC: 61.2,
    "DATE-OBS": dateObs,
    EXPTIME: 10.0,
    EXPOSURE: 10.0,
    FILTER: "LP",
    GAIN: 200,
    FOCALLEN: 150,
    XPIXSZ: 2.9,
    SITELAT: lat,
    SITELONG: lon,
  };
}

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// The e2e database is shared by the desktop and mobile projects, so each project imports a
// different target on a different night; the assertions are otherwise identical.
const PER_PROJECT = {
  desktop: { object: "NGC 7635", name: "Bubble Nebula", day: "2026-09-12", lat: 40.0, lon: -75.0, query: "NGC 7635" },
  mobile: { object: "M 27", name: "Dumbbell Nebula", day: "2026-09-14", lat: 41.0, lon: -76.0, query: "M 27" },
} as const;

test("import a folder, review it, commit, and see the target history", async ({ page, request }, testInfo) => {
  const cfg = PER_PROJECT[testInfo.project.name as keyof typeof PER_PROJECT];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  const loc = await request.post("/api/locations", {
    data: { label: `E2E ${testInfo.project.name}`, latitude_deg: cfg.lat, longitude_deg: cfg.lon, timezone: "America/New_York" },
  });
  expect(loc.ok()).toBeTruthy();

  const dir = mkdtempSync(join(tmpdir(), "astrolog-e2e-"));
  const folder = join(dir, "frames");
  mkdirSync(folder);
  const files: { name: string; buffer: Buffer }[] = [];
  for (let i = 0; i < 20; i++) {
    const t = `${cfg.day}T03:${String(11 + Math.floor((i * 10) / 60)).padStart(2, "0")}:${String((i * 10) % 60).padStart(2, "0")}.000000`;
    files.push({
      name: `Light_${cfg.object}_10.0s_LP_${i}.fit`,
      buffer: fitsFile(base(cfg.object, t, cfg.lat, cfg.lon)),
    });
  }
  files.push({
    name: `Stack_${cfg.object.replace(" ", "_")}.fit`,
    mimeType: "application/octet-stream",
    buffer: fitsFile({ ...base(cfg.object, `${cfg.day}T03:11:00.000000`, cfg.lat, cfg.lon), BITPIX: -32, PROGRAM: "Siril 1.4.4", STACKCNT: 12, LIVETIME: 120.0 }),
  });

  for (const f of files) writeFileSync(join(folder, f.name), f.buffer);

  await page.goto("/astrolog/import");
  await page.locator("#astrolog-folder").setInputFiles(folder);

  await expect(page.getByRole("heading", { name: "Review", level: 2 })).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(cfg.object) });
  await expect(row).toContainText("20");
  await expect(row).toContainText("3 m 20 s exposure");
  await page.getByRole("button", { name: /^Import 20 new frames and 1 stack$/ }).click();

  await expect(page).toHaveURL(/\/astrolog\/targets\//);
  // Before a final picture is linked to the stack, the headline is the captured time.
  await expect(page.getByText(/3 m 20 s captured/).first()).toBeVisible();
  await page.locator("input[type=file]").setInputFiles({ name: "final.png", mimeType: "image/png", buffer: Buffer.from(PNG_1X1, "base64") });
  await page.getByLabel("Stacked from").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Upload picture" }).click();
  await expect(page.getByText("2 m", { exact: true })).toBeVisible();
  await expect(page.getByText("in the final stack")).toBeVisible();
  await expect(page.getByText(/3 m 20 s captured/).first()).toBeVisible();

  await page.goto("/astrolog");
  await expect(page.getByRole("link", { name: new RegExp(cfg.name) }).first()).toBeVisible();

  // The planner card for that catalog target carries the history badge.
  await page.goto("/explore");
  await page.getByLabel(/search/i).first().fill(cfg.query);
  await expect(page.getByText(/You have 2 m stacked/).first()).toBeVisible();

  rmSync(dir, { recursive: true, force: true });
  expect(errors).toEqual([]);
});
