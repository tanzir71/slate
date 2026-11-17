import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures";

test("landing is accessible, responsive and links to the real app", async ({ page, isMobile }) => {
  await page.setViewportSize({ width: isMobile ? 390 : 1440, height: 900 });
  await page.goto("../");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Markdown at the speed of thought.");
  await page.evaluate(async () => { await document.fonts.ready; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.fonts.check("20px Newsreader"))).toBe(true);
  await expect.poll(() => page.locator(".workspace-shot").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(await page.locator(".workspace-shot").evaluate((image: HTMLImageElement) => new URL(image.currentSrc).pathname)).toMatch(isMobile ? /workspace-mobile\.avif$/ : /workspace-light\.jpg$/);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  await page.getByRole("link", { name: "Open in your browser", exact: true }).first().click();
  await expect(page).toHaveURL(/\/slate\/app\//);
  await expect(page.getByRole("heading", { name: "Where should your writing live?" })).toBeVisible();
});

test("mobile navigation opens, follows a link and closes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("../");
  const menu = page.locator(".mobile-menu");
  await menu.locator("summary").click();
  await expect(menu).toHaveAttribute("open", "");
  await menu.getByRole("link", { name: "Shortcuts", exact: true }).click();
  await expect(menu).not.toHaveAttribute("open");
  await expect(page).toHaveURL(/#shortcuts$/);
  await menu.locator("summary").click();
  await page.keyboard.press("Escape");
  await expect(menu).not.toHaveAttribute("open");
  await menu.locator("summary").click();
  await menu.getByRole("link", { name: "Ownership", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Your files. Your folders./ })).toBeVisible();
});
