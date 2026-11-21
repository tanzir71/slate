import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { nativeFixture } from "./nativeFixture";

test("compiled desktop renders local image bytes through disk IPC under CSP and retains physical source and one Undo", async ({ page }) => {
  const source = "\uFEFF# Images\r\n\r\n![Native](./cover.png)\r\n\r\nActive.\r\n", bytes = Array.from(readFileSync("apps/web/public/brand/icon-192.png"));
  await nativeFixture(page, { "images.md": source });
  await page.addInitScript(bytes => { if (!localStorage.getItem("native-file:space:cover.png")) localStorage.setItem("native-file:space:cover.png", JSON.stringify(bytes)); }, bytes);
  await page.goto("./");
  const button = page.getByRole("button", { name: "Show image source: Native", exact: true }), editor = page.locator(".cm-content");
  await expect(button.locator("img")).toBeVisible();
  await expect.poll(() => button.locator("img").evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
  const raw = () => page.evaluate(() => JSON.parse(localStorage.getItem("native-file:space:images.md") ?? "null") as number[] | null);
  await expect.poll(raw).toEqual(Array.from(Buffer.from(source)));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("native-file:space:cover.png") ?? "null") as number[] | null)).toEqual(bytes);
  await button.focus(); await button.press("Enter"); await expect(editor).toBeFocused(); await page.keyboard.insertText("Edited ");
  await expect.poll(raw).toEqual(Array.from(Buffer.from(source.replace("Native", "Edited Native"))));
  await editor.press("ControlOrMeta+z"); await expect.poll(raw).toEqual(Array.from(Buffer.from(source)));
  await editor.press("ControlOrMeta+End"); await expect(button.locator("img")).toBeVisible();
  await page.reload(); await expect(button.locator("img")).toBeVisible(); await expect.poll(raw).toEqual(Array.from(Buffer.from(source)));
});
