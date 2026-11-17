import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { createSheet, openLibrary } from "./helpers";

test("appearance follows System, remembers explicit choices and preserves writing", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openLibrary(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const editor = await createSheet(page, "# Appearance\n\nMy *own emphasis* stays mine.");
  const original = await editor.innerText();
  await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Appearance", exact: true })).toHaveValue("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(() => editor.innerText()).toBe(original);
  await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.locator(".browserEditor").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(27, 27, 26)");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(() => editor.innerText()).toBe(original);
});
