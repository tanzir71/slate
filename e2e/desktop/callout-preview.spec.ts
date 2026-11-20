import { expect, test } from "@playwright/test";
import { nativeFixture } from "./nativeFixture";

test("native callout cards load under CSP and keep exact IPC bytes through source editing and Undo", async ({ page }) => {
  const source = "\uFEFF# Callout\r\n\r\n> [!NOTE] Native note\r\n> Words worth keeping.\r\n\r\nActive.\r\n";
  await nativeFixture(page, { "Callout.md": source });
  await page.goto("./");
  const editor = page.locator(".cm-content"), title = page.locator(".cm-slate-callout-title");
  await expect(page.locator(".browserWorkspace")).toHaveAttribute("data-editor-ready", "true");
  await expect(title).toHaveText("Native note");
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("native-file:space:Callout.md") ?? "null") as number[] | null);
  const bytes = (text: string) => Array.from(Buffer.from(text));
  expect(await saved()).toEqual(bytes(source));
  await expect.poll(() => title.locator(".cm-slate-callout-icon img:visible").evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(16);
  await title.locator(".cm-slate-callout-icon img:visible").click();
  await expect(title).toHaveCount(0);
  await expect(editor).toBeFocused();
  await expect(editor).toContainText("> [!NOTE] Native note");
  await editor.press("End");
  await page.keyboard.insertText("!");
  await expect.poll(saved).toEqual(bytes(source.replace("Native note", "Native note!")));
  await editor.press("ControlOrMeta+z");
  await expect.poll(saved).toEqual(bytes(source));
  await editor.press("ControlOrMeta+End");
  await expect(title).toHaveText("Native note");
});
