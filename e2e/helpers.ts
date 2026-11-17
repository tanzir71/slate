import { expect, type Page } from "@playwright/test";

export async function openLibrary(page: Page) {
  await page.goto("./");
  await page.getByText("Keep notes in this browser", { exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Sheets", exact: true })).toBeVisible();
}

export async function createSheet(page: Page, text = "# My writing\n\nWords worth keeping.") {
  await page.getByRole("button", { name: "New Sheet", exact: true }).first().click();
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.click();
  await page.keyboard.insertText(text);
  await expect(page.getByRole("status", { name: "" }).filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 15_000 });
  return editor;
}
