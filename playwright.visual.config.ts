import { defineConfig, devices } from "@playwright/test";

/** Pixel baselines use the pinned Linux image documented in docs/visual-testing.md. */
export default defineConfig({
  testDir: "./e2e/visual",
  workers: 1,
  timeout: 60_000,
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  outputDir: "test-results/visual",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/visual" }]],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide", scale: "css" } },
  use: {
    baseURL: "http://127.0.0.1:4178/slate/app/",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node scripts/serve-static.mjs site-dist 4178 /slate",
    url: "http://127.0.0.1:4178/slate/app/",
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium-linux", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
