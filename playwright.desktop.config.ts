import { defineConfig, devices } from "@playwright/test";

/** Exercise the actual built desktop frontend; native disk writes use an explicit IPC fixture. */
export default defineConfig({
  testDir: "./e2e/desktop",
  workers: 1,
  timeout: 30_000,
  outputDir: "test-results/desktop",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/desktop" }]],
  use: {
    baseURL: "http://127.0.0.1:4176/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node scripts/serve-static.mjs apps/desktop/dist 4176",
    url: "http://127.0.0.1:4176/",
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } }],
});
