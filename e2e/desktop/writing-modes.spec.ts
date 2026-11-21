import { expect, test } from "@playwright/test";
import { nativeFixture } from "./nativeFixture";

test("native Zen and writing focus keep the same editor and preserve IPC bytes with shared Undo", async ({ page }) => {
  const source = "\uFEFFFirst paragraph stays.\r\n\r\nSecond paragraph stays.\r\n";
  await nativeFixture(page, { "note.md": source }); await page.goto("./"); const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible(); await editor.press("ControlOrMeta+End");
  await editor.press("ControlOrMeta+Period"); await expect(page.locator(".cm-writing-dim").first()).toHaveCSS("opacity", "0.3");
  await editor.evaluate(element => element.setAttribute("data-writing-identity", "kept"));
  await page.keyboard.press("F11"); await expect(page.locator(".workspaceHeader")).toBeHidden();
  await expect(page.locator('[data-writing-identity="kept"]')).toBeFocused(); await page.keyboard.insertText("Native Zen draft");
  const raw = () => page.evaluate(() => JSON.parse(localStorage.getItem("native-file:space:note.md") ?? "null") as number[] | null);
  await expect.poll(raw).toEqual(Array.from(Buffer.from(source + "Native Zen draft")));
  await page.keyboard.press("Escape"); await expect(page.locator(".workspaceHeader")).toBeVisible();
  await expect(page.locator('[data-writing-identity="kept"]')).toBeFocused(); await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(raw).toEqual(Array.from(Buffer.from(source)));
});
