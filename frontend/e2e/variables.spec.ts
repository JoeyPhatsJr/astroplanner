import { expect, test, type Page } from "@playwright/test";

// Fallback tests run against the default backend (AAVSO off). Tests tagged @fixture run against a
// second backend that reads SYNTHETIC AAVSO CSV fixtures (see make-aavso-fixtures.mjs): no network.

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
}

async function navLink(page: Page, projectName: string, withDot = false) {
  const mobile = projectName.endsWith("mobile");
  const name = withDot ? "Variable Hunter, new sky alert" : mobile ? "Variables" : "Variable Hunter";
  return page.getByRole("link", { name, exact: true });
}

test("nav reaches Variable Hunter; /research redirects there", async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await (await navLink(page, testInfo.project.name)).click();
  await expect(page).toHaveURL(/\/variables$/);
  await expect(page.getByRole("heading", { name: "Variable Hunter", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /SS Cyg/ }).first()).toBeVisible();
  await expect(page.getByText("Catalog data: International Variable Star Index (VSX), operated at AAVSO, Cambridge, Massachusetts, USA.")).toBeVisible();
  // AAVSO is off: the observation attribution must not appear
  await expect(page.getByText(/Observations from the AAVSO International Database/)).toHaveCount(0);

  await page.goto("/research");
  await expect(page).toHaveURL(/\/variables$/);
  expect(errors).toEqual([]);
});

test("SS Cyg page without AAVSO: VSX link, no chart, plan add survives reload", async ({ page, request }) => {
  // The e2e database is shared by every project and spec: start and finish without SS Cyg planned.
  const unplan = async () => {
    const sessions = await (await request.get("/api/sessions")).json();
    for (const s of sessions)
      for (const t of s.targets)
        if (t.target_id === "var:ss-cyg") await request.delete(`/api/sessions/${s.id}/targets/${t.id}`);
  };
  await unplan();
  try {
    await checkSsCygPage(page);
  } finally {
    await unplan();
  }
});

async function checkSsCygPage(page: Page) {
  await page.goto("/variables/ss-cyg");
  await expect(page.getByRole("heading", { name: "SS Cyg", level: 1 })).toBeVisible();
  await expect(page.getByText("Light curve: not shown. AAVSO data is switched off in this app until its terms are confirmed.")).toBeVisible();
  const vsx = page.getByRole("link", { name: /View SS Cyg on AAVSO VSX/ });
  await expect(vsx).toHaveAttribute("href", /vsx\.aavso\.org/);
  await expect(page.locator("svg[role='img'], canvas")).toHaveCount(0);
  await expect(page.getByText("Magnitude (V)")).toHaveCount(0);

  const add = page.getByRole("button", { name: "Add to tonight's plan" });
  await expect(add).toBeVisible();
  if (await add.isDisabled()) {
    // SS Cyg may be below the horizon all night at some times of year: the reason must be stated
    await expect(page.locator("#vh-add-reason")).toBeVisible();
    return;
  }
  await add.click();
  await expect(page.getByRole("button", { name: "In tonight's plan" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "In tonight's plan" })).toBeVisible();
}

test("Tonight has no Sky alerts card when AAVSO is off", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Tonight", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sky alerts" })).toHaveCount(0);
});

test("@fixture Sky alerts: SS Cyg outburst evidence, nav dot, honest unavailable row", async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  await page.goto("/");
  const card = page.getByRole("region", { name: "Sky alerts" });
  await expect(card).toBeVisible();
  const ss = card.getByRole("listitem").filter({ hasText: "SS Cygni" });
  await expect(ss).toContainText("in outburst");
  await expect(ss).toContainText(/\d+ observers reported it brighter than 10 in the last 48 h · AAVSO, checked/);
  await expect(card.getByRole("listitem").filter({ hasText: "T Coronae Borealis" })).toContainText("no change");
  // U Gem has no fixture file: stated as missing data, never as "no change"
  const gem = card.getByRole("listitem").filter({ hasText: "U Geminorum" });
  await expect(gem).toContainText("No AAVSO data yet");
  await expect(gem).not.toContainText("no change");
  await expect(card.getByText("Observations from the AAVSO International Database, contributed by observers worldwide. © AAVSO.")).toBeVisible();
  await expect(await navLink(page, testInfo.project.name, true)).toBeVisible();
  // Observer identity never reaches the page
  await expect(page.locator("body")).not.toContainText(/ZZ_SENTINEL|ZZOB|ZZSEN/);
  expect(errors).toEqual([]);
});

test("@fixture SS Cyg page shows the light curve and its source line", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/variables/ss-cyg");
  await expect(page.getByRole("heading", { name: "Light curve", level: 2 })).toBeVisible();
  await expect(page.getByText(/AAVSO International Database via VSX · \d+ observations cached/)).toBeVisible();
  await expect(page.getByText(/Bands shown: .*Vis/)).toBeVisible();
  await expect(page.getByText(/Magnitude \(V\)/).first()).toBeVisible();
  await expect(page.getByText(/Brighter ↑/).first()).toBeVisible();
  await expect(page.getByText("Observations from the AAVSO International Database, contributed by observers worldwide. © AAVSO.").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/ZZ_SENTINEL|ZZOB|ZZSEN/);
  expect(errors).toEqual([]);
});

test("@fixture U Gem page reports missing AAVSO data instead of an empty chart", async ({ page }) => {
  await page.goto("/variables/u-gem");
  await expect(page.getByRole("heading", { name: "U Gem", level: 1 })).toBeVisible();
  await expect(page.getByText(/AAVSO unreachable \(.*\)\./)).toBeVisible();
  await expect(page.getByText("No successful check yet.")).toBeVisible();
});
