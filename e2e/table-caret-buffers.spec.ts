import { expect, test } from "./fixtures";
import { openLibrary } from "./helpers";
import { libraryFile } from "./libraryFiles";
import { tableFileSource } from "./tablePreviewFixture";

test("invisible caret buffers cannot expand preview table rows or change saved bytes", async ({ page }) => {
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles({
    name: "Table.md", mimeType: "text/markdown", buffer: Buffer.from(tableFileSource),
  });
  const grid = page.locator(".cm-slate-table-grid");
  await expect(grid).toBeVisible();
  const count = await grid.locator(".cm-slate-table-cell .cm-widgetBuffer").evaluateAll(buffers => {
    // Amplify platform-dependent text-top/1em buffer metrics. These zero-width,
    // aria-hidden images support native caret mapping and are never cell content.
    for (const buffer of buffers) (buffer as HTMLElement).style.height = "60px";
    return buffers.length;
  });
  expect(count).toBeGreaterThan(0);
  expect(await grid.getByRole("row").evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height)))
    .toEqual([39, 39, 39, 38]);
  expect(await grid.evaluate(element => element.getBoundingClientRect().height)).toBe(157);
  await expect.poll(() => libraryFile(page, "Table.md")).toEqual(Array.from(Buffer.from(tableFileSource)));
  const editor = page.locator(".cm-content");
  await grid.getByRole("cell", { name: "Beta", exact: true }).click();
  await expect(grid).toHaveCount(0);
  await expect(editor).toBeFocused();
  await editor.press("Home");
  await editor.press("ArrowRight");
  await editor.press("ArrowRight");
  await page.keyboard.insertText("New ");
  await expect.poll(() => libraryFile(page, "Table.md"))
    .toEqual(Array.from(Buffer.from(tableFileSource.replace("| Beta |", "| New Beta |"))));
  await editor.press("ControlOrMeta+z");
  await expect.poll(() => libraryFile(page, "Table.md")).toEqual(Array.from(Buffer.from(tableFileSource)));
});
