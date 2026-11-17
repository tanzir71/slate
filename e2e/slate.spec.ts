import { expect, test } from "./fixtures";
import { createSheet, openLibrary, showSheets } from "./helpers";

test("creates a persistent browser sheet with palette and inspector closed", async ({ page }) => {
  await openLibrary(page);
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();
  await expect(page.getByRole("complementary", { name: "Inspector" })).toBeHidden();
  await createSheet(page);
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("Words worth keeping.");
  await expect(page).toHaveURL(/\/slate\/app\/#\/space\/.+\/sheet\/Inbox%2FUntitled.md/);
});

test("filters sheets by search text", async ({ page }) => {
  await openLibrary(page);
  await createSheet(page, "# Research\n\nA unique research note.");
  await page.getByRole("button", { name: "New Sheet", exact: true }).first().click();
  await showSheets(page);
  await page.getByRole("textbox", { name: "Search sheets" }).fill("unique");
  await expect(page.getByRole("button", { name: /Research.*unique research/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Untitled.*Start writing/ })).toBeHidden();
});

