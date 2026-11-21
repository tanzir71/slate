import { expect, test } from "@playwright/test";
import { nativeFixture } from "./nativeFixture";

test("compiled desktop loads local code grammars under CSP and retains IPC bytes and one Undo", async ({ page }) => {
  const source = "\uFEFF# Code\r\n\r\n```python\r\ndef greet():\r\n    return 'Hello'\r\n```\r\n\r\nActive.\r\n";
  await nativeFixture(page, { "code.md": source }); await page.goto("./");
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible(); await editor.press("ControlOrMeta+End");
  await expect(page.locator(".cm-slate-code-line .tok-keyword").first()).toHaveText("def");
  const raw = () => page.evaluate(() => JSON.parse(localStorage.getItem("native-file:space:code.md") ?? "null") as number[] | null);
  await expect.poll(raw).toEqual(Array.from(Buffer.from(source)));
  await page.getByRole("button", { name: "Show python code fence in source", exact: true }).click();
  await expect(editor).toBeFocused(); await page.keyboard.insertText("3");
  await expect.poll(raw).toEqual(Array.from(Buffer.from(source.replace("```python", "```3python"))));
  await editor.press("ControlOrMeta+z"); await expect.poll(raw).toEqual(Array.from(Buffer.from(source)));
  await editor.press("ControlOrMeta+End"); await expect(page.locator(".cm-slate-code-language")).toHaveText("python");
});
