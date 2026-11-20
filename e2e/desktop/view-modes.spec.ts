import { expect, test } from "@playwright/test";
import { nativeFixture } from "./nativeFixture";

test("native view modes retain exact IPC bytes and history across Read and a reload", async ({ page }) => {
  const source = "\uFEFF# Native\r\n\r\n**Words kept.**\r\n";
  await nativeFixture(page, { "note.md": source }); await page.goto("./"); const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible(); await editor.press("ControlOrMeta+End"); await page.keyboard.insertText("Draft");
  const raw = () => page.evaluate(() => JSON.parse(localStorage.getItem("native-file:space:note.md") ?? "null") as number[] | null);
  await expect.poll(raw).toEqual(Array.from(Buffer.from(source + "Draft")));
  await editor.press("ControlOrMeta+e"); await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+e"); await expect(editor).toHaveAttribute("contenteditable", "false");
  await page.keyboard.press("x"); await page.keyboard.press("ControlOrMeta+z"); expect(await raw()).toEqual(Array.from(Buffer.from(source + "Draft")));
  await page.keyboard.press("ControlOrMeta+e"); await expect(editor).toHaveAttribute("contenteditable", "true");
  await page.keyboard.press("ControlOrMeta+z"); await expect.poll(raw).toEqual(Array.from(Buffer.from(source)));
  await page.locator(".headerViewMode").getByRole("radio", { name: "Source", exact: true }).click();
  await page.reload(); await expect(page.locator(".cm-lineNumbers")).toBeVisible(); expect(await raw()).toEqual(Array.from(Buffer.from(source)));
});
