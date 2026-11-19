import { defineConfig } from "@playwright/test";
import base from "./playwright.performance.config";

/** Use the same four reference profiles and a fresh process for the 10k-file palette. */
export default defineConfig({
  ...base,
  testMatch: "**/palette-performance.spec.ts",
  outputDir: "test-results/palette-performance",
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/palette-performance/results.json" }],
    ["html", { open: "never", outputFolder: "playwright-report/palette-performance" }],
  ],
});
