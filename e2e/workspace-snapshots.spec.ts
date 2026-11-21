import { expect, test } from "./fixtures";
import { createSheet, openLibrary, showSheets } from "./helpers";
import { libraryFile } from "./libraryFiles";

test("external refresh reads fresh physical Markdown without traversing the Space on the UI thread", async ({ page }) => {
  await openLibrary(page);
  await createSheet(page, "# Before\n\nMy original words.");
  const path = decodeURIComponent(new URL(page.url()).hash.split("/")[4]!);
  const source = "\uFEFF# External revision\r\n\r\nKeep বাংলা and every word.\r\n";
  const legacy = [0xff, 0xfe, 0x41, 0];
  await libraryFile(page, path, source);
  await libraryFile(page, "External/New.md", "# New from disk\n\nFresh content.");
  await libraryFile(page, "Legacy.md", legacy);
  await page.evaluate(() => {
    const id = decodeURIComponent(location.hash.split("/")[2]!);
    const prototype = FileSystemDirectoryHandle.prototype, original = prototype.entries;
    Reflect.set(window, "spaceRootTraversals", 0);
    prototype.entries = function (...args: Parameters<typeof original>) {
      if (this.name === id) Reflect.set(window, "spaceRootTraversals", Number(Reflect.get(window, "spaceRootTraversals")) + 1);
      return Reflect.apply(original, this, args);
    };
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.locator(".cm-content")).toContainText("Keep বাংলা and every word.");
  await showSheets(page);
  await expect(page.getByRole("button", { name: /New from disk/ })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "spaceRootTraversals"))).toBe(0);
  expect(await libraryFile(page, path)).toEqual(Array.from(Buffer.from(source, "utf8")));
  expect(await libraryFile(page, "Legacy.md")).toEqual(legacy);
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText("Saved");
});
