import { expect, test } from "./fixtures";
import { createSheet, expectSavedSheet, openLibrary, readCurrentSheet } from "./helpers";
import type { Page } from "@playwright/test";

async function blockCatalogWrites(page: Page) {
  await page.addInitScript(() => {
    const probe = { attempts: 0 };
    Reflect.set(window, "catalogWriteProbe", probe);
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      if (this.name === "slate-spaces" && mode === "readwrite") {
        probe.attempts++;
        throw new DOMException("Catalog writes unavailable", "QuotaExceededError");
      }
      return transaction.call(this, names, mode, options);
    };
  });
}

test("reopens saved writing without requiring an unchanged catalog entry to be rewritten", async ({ page }) => {
  await openLibrary(page);
  const source = "# Saved writing\n\nKeep my বাংলা words.";
  await createSheet(page, source);
  expect(await readCurrentSheet(page)).toBe(source);
  await blockCatalogWrites(page);
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("Keep my বাংলা words.");
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "true");
  expect(await page.evaluate(() => Reflect.get(window, "catalogWriteProbe").attempts as number)).toBe(0);
  expect(await readCurrentSheet(page)).toBe(source);
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(" Still writing.");
  await expectSavedSheet(page, source + " Still writing.");
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("Still writing.");
  expect(await page.evaluate(() => Reflect.get(window, "catalogWriteProbe").attempts as number)).toBe(0);
  expect(await readCurrentSheet(page)).toBe(source + " Still writing.");
});

test("requires a durable catalog entry before offering a newly created Space for writing", async ({ page }) => {
  await blockCatalogWrites(page);
  await page.goto("./");
  await page.getByText("Keep notes in this browser", { exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Catalog writes unavailable");
  await expect(page.locator(".workspaceHeader, .cm-content")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "catalogWriteProbe").attempts as number)).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem("slate.last-space"))).toBeNull();
});
