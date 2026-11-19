import { defineConfig } from "@playwright/test";
import base from "./playwright.performance.config";

/** The real emitted worker, with all Linux reference profiles and no retries. */
export default defineConfig({
  ...base,
  retries: 0,
  testMatch: "**/tidy-performance.spec.ts",
  outputDir: "test-results/tidy-performance",
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/tidy-performance/results.json" }],
    [
      "html",
      { open: "never", outputFolder: "playwright-report/tidy-performance" },
    ],
  ],
});
