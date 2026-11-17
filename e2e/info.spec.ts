import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { createSheet, openLibrary } from "./helpers";

test("About shows release notes, capabilities and author credit with keyboard dismissal", async ({ page, context }) => {
  await page.goto("./");
  const about = page.getByRole("button", { name: "About Slate", exact: true });
  await about.click();
  const dialog = page.getByRole("dialog", { name: "About Slate" });
  await expect(dialog.getByRole("heading", { name: /What’s new in Slate 0\.2\.0/ })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "tanziro.com" })).toHaveAttribute("href", "https://tanziro.com");
  await expect(dialog.getByRole("table")).toContainText("Private browser library");
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(about).toBeFocused();

  await openLibrary(page);
  await createSheet(page, "# Words\n\nStill mine.");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await about.click();
  await expect(dialog.getByRole("heading", { name: /What’s new in Slate 0\.2\.0/ })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("Still mine.");
});
