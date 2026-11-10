import { defineConfig, devices } from "@playwright/test";

// Smoke test of the core Phase 1 flow against the REAL backend (fresh SQLite file)
// on dedicated ports, so it never touches a developer's running dev servers or data.
// Override the ports (E2E_API_PORT / E2E_WEB_PORT) to run two worktrees' suites side by side.
const API_PORT = Number(process.env.E2E_API_PORT ?? 8100);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5180);

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
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
  ],
});
