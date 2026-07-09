import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("has no critical accessibility violations on the primary workspace", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Slate").first()).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const criticalViolations = results.violations.filter((violation) => violation.impact === "critical");

  expect(criticalViolations).toEqual([]);
});

