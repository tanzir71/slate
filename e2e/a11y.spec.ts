import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { createSheet, openLibrary } from "./helpers";

test("has no critical accessibility violations on the primary workspace", async ({ page }) => {
  await openLibrary(page);
  await createSheet(page);

  const results = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const criticalViolations = results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");

  expect(criticalViolations).toEqual([]);
});

test("first run has no serious or critical accessibility violations", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Where should your writing live?" })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")).toEqual([]);
});

