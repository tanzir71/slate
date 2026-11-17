import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** Timing budgets use fresh browser processes, separate from the workflow suite. */
export default defineConfig({
  ...base,
  testMatch: "**/typing-performance.spec.ts",
  testIgnore: [],
  outputDir: "test-results/typing",
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/typing/results.json" }],
    ["html", { open: "never", outputFolder: "playwright-report/typing" }],
  ],
});
