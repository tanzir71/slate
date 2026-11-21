import { defineConfig } from "@playwright/test";
import base from "../playwright.config";

/** Only observation artifacts change; original case bodies and deadlines remain. */
export default defineConfig({
  ...base,
  testDir: "../e2e",
  testMatch: ["**/keyboard.spec.ts", "**/table-preview.spec.ts", "**/image-preview.spec.ts"],
  grep: /keyboard-only walkthrough completes core workspace flows|table grids retain exact BOM and CRLF through themed preview, native cell selection, editing and one Undo|local image previews fit both themes and preserve physical bytes, keyboard source editing, one Undo and offline reload/,
  retries: 0, workers: 1, fullyParallel: false,
  projects: (base.projects ?? []).filter(project => project.name === "chromium" || project.name === "firefox"),
  outputDir: "../test-results/platform-diagnostics",
  reporter: [["list"], ["json", { outputFile: "test-results/platform-diagnostics/report.json" }], ["html", { open: "never", outputFolder: "playwright-report/platform-diagnostics" }]],
  use: { ...base.use, trace: "on" },
});
