import { expect, test } from "@playwright/test";
import { nativeFixture } from "./nativeFixture";
import { tableFileSource } from "../tablePreviewFixture";

test("native table grids preserve exact IPC bytes and source cell editing with one Undo", async ({ page }) => {
  await nativeFixture(page, { "Table.md": tableFileSource });
  await page.goto("./");
  await expect(page.locator(".browserWorkspace")).toHaveAttribute("data-editor-ready", "true");
  const grid = page.locator(".cm-slate-table-grid"), editor = page.locator(".cm-content");
  await expect(grid.getByRole("columnheader")).toHaveText(["Phase", "Scope", "Target"]);
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("native-file:space:Table.md") ?? "null") as number[] | null);
  const bytes = (source: string) => Array.from(Buffer.from(source));
  expect(await saved()).toEqual(bytes(tableFileSource));
  await grid.getByRole("cell", { name: "Beta", exact: true }).click();
  await expect(grid).toHaveCount(0);
  await expect(editor).toBeFocused();
  await editor.press("Home"); await editor.press("ArrowRight"); await editor.press("ArrowRight");
  await page.keyboard.insertText("New ");
  await expect.poll(saved).toEqual(bytes(tableFileSource.replace("| Beta |", "| New Beta |")));
  await editor.press("ControlOrMeta+z");
  await expect.poll(saved).toEqual(bytes(tableFileSource));
  await editor.press("ControlOrMeta+End");
  await expect(grid.getByRole("cell", { name: "Beta", exact: true })).toBeVisible();
});
