import { expect, test, type Page } from "@playwright/test";
import { API_HEADERS, collectErrors, signUp } from "./auth";

// AstroPlanner downloads no AAVSO observations: star pages show VSX catalog facts and link to AAVSO.

// Plans belong to an account, and Tonight and the star pages load the active plan; sign in first.
test.beforeEach(async ({ page }) => {
  await signUp(page);
});

async function navLink(page: Page, projectName: string) {
  const mobile = projectName.endsWith("mobile");
  const name = mobile ? "Variables" : "Variable Hunter";
  return page.getByRole("link", { name, exact: true });
}

test("nav reaches Variable Hunter; /research redirects there", async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.goto("/tonight");
  await (await navLink(page, testInfo.project.name)).click();
  await expect(page).toHaveURL(/\/variables$/);
  await expect(page.getByRole("heading", { name: "Variable Hunter", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /SS Cyg/ }).first()).toBeVisible();
  await expect(page.getByText("Catalog data: International Variable Star Index (VSX), operated at AAVSO, Cambridge, Massachusetts, USA.")).toBeVisible();
  // No AAVSO observations are shown, so their attribution must not appear
  await expect(page.getByText(/Observations from the AAVSO International Database/)).toHaveCount(0);

  await page.goto("/research");
  await expect(page).toHaveURL(/\/variables$/);
  expect(errors).toEqual([]);
});

test("SS Cyg page: VSX link, no chart, plan add survives reload", async ({ page }) => {
  // Start and finish without SS Cyg planned. The account is new, but the cleanup keeps the test self-contained.
  // page.request carries the signed-in page's session cookie.
  const unplan = async () => {
    const r = await page.request.get("/api/sessions");
    expect(r.ok()).toBeTruthy();
    for (const s of await r.json())
      for (const t of s.targets)
        if (t.target_id === "var:ss-cyg")
          await page.request.delete(`/api/sessions/${s.id}/targets/${t.id}`, { headers: API_HEADERS });
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
  await expect(page.getByText(/AstroPlanner doesn.t download AAVSO observations, so it draws no light curve/)).toBeVisible();
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
