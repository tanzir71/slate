import { expect, test } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { openLibrary, workspaceAction } from "./helpers";
import { libraryFile, libraryPaths } from "./libraryFiles";
import { importPixel, sourceImportCases, sourceImportFixture } from "./sourceImportFixtures";

const original = "\ufeff# Kept\r\n\r\nPrior words.\r\n";
async function prepare(page: import("@playwright/test").Page) {
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "kept.md", mimeType: "text/markdown", buffer: Buffer.from(original) });
  await expect(page.locator(".sheetRowContainer strong").filter({ hasText: /^Kept$/ })).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+p"); const quick = page.getByRole("dialog", { name: "Quick open", exact: true });
  await quick.locator("input").fill("kept.md"); await quick.getByRole("button").filter({ hasText: "kept.md" }).click();
  await expect(quick).toBeHidden(); await expect(page.locator(".cm-content")).toContainText("Prior words.");
  await workspaceAction(page, "Import from another app");
  const dialog = page.getByRole("dialog", { name: "Import from another app", exact: true });
  await expect(dialog.getByRole("combobox", { name: "Source application", exact: true })).toBeFocused();
  return dialog;
}
for (const item of sourceImportCases) test(`${item.id} export imports locally with attachments, reviewed writes and exact existing bytes`, async ({ page }) => {
  const external: string[] = []; page.on("request", request => { if (request.url().includes("export.invalid")) external.push(request.url()); });
  await page.route("**/export.invalid/**", route => route.abort());
  const dialog = await prepare(page);
  await dialog.getByRole("combobox", { name: "Source application", exact: true }).selectOption(item.id);
  await dialog.getByLabel("Choose export files", { exact: true }).setInputFiles(await sourceImportFixture(item.id));
  await expect(dialog.getByRole("region", { name: "Import preview", exact: true })).toBeVisible();
  expect((await libraryPaths(page, true)).some(path => path.startsWith("Imported from "))).toBe(false);
  expect(await libraryFile(page, "kept.md")).toEqual(Array.from(Buffer.from(original)));
  await expect(dialog.getByRole("button", { name: "Import notes", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport({ ratio: 1 });
  if (item.id === "apple-notes") {
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: "test-results/source-import-reviewed-" + test.info().project.name + ".png" });
    await expect(dialog).toContainText("Remote images were kept as links");
    await dialog.locator(".sourceImportBody").evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(dialog.getByText("Active HTML was kept only in the original export.", { exact: true })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole("button", { name: "Import notes", exact: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: "test-results/source-import-review-end-" + test.info().project.name + ".png" });
  }
  await dialog.getByRole("button", { name: "Import notes", exact: true }).click(); await expect(dialog).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText(item.heading);
  const label = item.id === "apple-notes" ? "Apple Notes" : item.id[0]!.toUpperCase() + item.id.slice(1), root = "Imported from " + label;
  await expect.poll(() => libraryFile(page, root + "/" + item.image)).toEqual(Array.from(importPixel));
  expect(await libraryFile(page, "kept.md")).toEqual(Array.from(Buffer.from(original)));
  const data = await libraryFile(page, root + "/" + item.note); expect(data).toBeDefined();
  const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(data!));
  if (item.id === "bear") expect(body).toBe("\ufeff# From Bear\r\n\r\n![Pixel](assets/pixel.png)\r\n");
  if (item.id === "notion") { expect(body).toContain("[Child](Parent/Child.md)"); expect(await libraryFile(page, ".slate/keymap.json")).toBeUndefined(); }
  if (item.id === "evernote") { expect(body).toContain('created: "2026-11-22T01:02:03Z"'); expect(body).toContain("- [x] Done"); }
  if (item.id === "apple-notes") { expect(body).toContain("**bold**"); expect(body).not.toContain("![Remote]"); expect(await libraryFile(page, root + "/Sources/Apple.html")).toBeDefined(); }
  expect(external).toEqual([]); expect(await page.evaluate(() => Reflect.get(globalThis, "sourceImportExecuted"))).toBeUndefined();
});
test("cancelling a reviewed application import preserves the current library", async ({ page }) => {
  const dialog = await prepare(page);
  await dialog.getByLabel("Choose export files", { exact: true }).setInputFiles(await sourceImportFixture("bear"));
  await expect(dialog.getByRole("region", { name: "Import preview", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport({ ratio: 1 });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(dialog).toBeHidden();
  expect((await libraryPaths(page, true)).some(path => path.startsWith("Imported from "))).toBe(false);
  expect(await libraryFile(page, "kept.md")).toEqual(Array.from(Buffer.from(original)));
});
