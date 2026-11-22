import { expect, test } from "@playwright/test";
import { nativeFixture } from "./nativeFixture";
import { workspaceAction } from "../helpers";
import { importPixel, sourceImportCases, sourceImportFixture } from "../sourceImportFixtures";

for (const item of sourceImportCases) test(`native ${item.id} imports through guarded Space-relative IO without changing current words`, async ({ page }) => {
  const original = "\ufeff# Existing\r\n\r\nKeep these words.\r\n";
  await nativeFixture(page, { "kept.md": original }); await page.goto("./");
  await expect(page.locator(".cm-content")).toContainText("Keep these words.");
  await workspaceAction(page, "Import from another app");
  const dialog = page.getByRole("dialog", { name: "Import from another app", exact: true });
  await dialog.getByRole("combobox", { name: "Source application", exact: true }).selectOption(item.id);
  await dialog.getByLabel("Choose export files", { exact: true }).setInputFiles(await sourceImportFixture(item.id));
  await expect(dialog.getByRole("region", { name: "Import preview", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Import notes", exact: true })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith("native-file:space:Imported from ")))).toBe(false);
  await dialog.getByRole("button", { name: "Import notes", exact: true }).click(); await expect(dialog).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText(item.heading);
  const label = item.id === "apple-notes" ? "Apple Notes" : item.id[0]!.toUpperCase() + item.id.slice(1), root = "Imported from " + label;
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("native-file:space:kept.md") ?? "null") as number[] | null)).toEqual(Array.from(Buffer.from(original)));
  expect(await page.evaluate(path => JSON.parse(localStorage.getItem("native-file:space:" + path) ?? "null") as number[] | null, root + "/" + item.image)).toEqual(Array.from(importPixel));
});
