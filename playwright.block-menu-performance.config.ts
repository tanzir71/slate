import { defineConfig } from "@playwright/test";
import base from "./playwright.performance.config";

/** A separate process preserves fresh browsers for the existing typing reference. */
export default defineConfig({
  ...base,
  testMatch: "**/block-menu-performance.spec.ts",
  outputDir: "test-results/block-menu-performance",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "test-results/block-menu-performance/results.json" },
    ],
    [
      "html",
      {
        open: "never",
        outputFolder: "playwright-report/block-menu-performance",
      },
    ],
  ],
});
