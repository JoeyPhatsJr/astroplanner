import { defineConfig, devices } from "@playwright/test";

// Smoke test of the core Phase 1 flow against the REAL backend (fresh SQLite file)
// on dedicated ports, so it never touches a developer's running dev servers or data.
const API_PORT = 8100;
const WEB_PORT = 5180;
// Second pair for tests that need AAVSO data: the backend reads synthetic CSV fixtures
// (e2e/aavso-fixtures, regenerated with times relative to "now" just before it starts).
const FIXTURE_API_PORT = 8101;
const FIXTURE_WEB_PORT = 5181;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", grepInvert: /@fixture/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", grepInvert: /@fixture/, use: { ...devices["Pixel 7"] } },
    // Only tests tagged @fixture run here, against the fixture-backed servers.
    {
      name: "fixture-desktop",
      grep: /@fixture/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL: `http://127.0.0.1:${FIXTURE_WEB_PORT}` },
    },
    { name: "fixture-mobile", grep: /@fixture/, use: { ...devices["Pixel 7"], baseURL: `http://127.0.0.1:${FIXTURE_WEB_PORT}` } },
  ],
  webServer: [
    {
      command: `rm -rf e2e/.e2e.db e2e/.previews && ASTROPLANNER_DB=e2e/.e2e.db ASTROPLANNER_PREVIEWS_DIR=e2e/.previews ../backend/.venv/bin/uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port ${API_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `API_PROXY_TARGET=http://127.0.0.1:${API_PORT} npx vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `rm -rf e2e/.e2e-fixture.db e2e/.previews-fixture && node e2e/make-aavso-fixtures.mjs && ASTROPLANNER_DB=e2e/.e2e-fixture.db ASTROPLANNER_PREVIEWS_DIR=e2e/.previews-fixture ASTROPLANNER_AAVSO_FIXTURE_DIR=e2e/aavso-fixtures ../backend/.venv/bin/uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port ${FIXTURE_API_PORT}`,
      url: `http://127.0.0.1:${FIXTURE_API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `API_PROXY_TARGET=http://127.0.0.1:${FIXTURE_API_PORT} npx vite --host 127.0.0.1 --port ${FIXTURE_WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${FIXTURE_WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
