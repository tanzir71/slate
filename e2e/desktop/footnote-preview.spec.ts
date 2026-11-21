import { expect, test } from "@playwright/test";
import { nativeFixture } from "./nativeFixture";

test("compiled desktop previews local footnotes under CSP and retains IPC bytes and shared Undo", async ({ page }) => {
  const source = "\uFEFF# Notes\r\n\r\nA claim[^note].\r\n\r\n[^note]: A **strong** note.\r\n\r\nActive.\r\n";
  await nativeFixture(page, { "notes.md": source }); await page.goto("./");
  const editor = page.locator(".cm-content"); await expect(editor).toBeVisible(); await editor.press("ControlOrMeta+End");
  const button = page.getByRole("button", { name: "Footnote note", exact: true }); await button.click();
  await expect(page.getByRole("tooltip")).toHaveText("A strong note.");
  const raw = () => page.evaluate(() => JSON.parse(localStorage.getItem("native-file:space:notes.md") ?? "null") as number[] | null);
  await expect.poll(raw).toEqual(Array.from(Buffer.from(source)));
  await editor.getByText("A claim", { exact: false }).click({ position: { x: 3, y: 10 } });
  await expect(editor).toContainText("A claim[^note]."); await expect(button).toHaveCount(0);
  await editor.press("End"); await page.keyboard.insertText("!");
  await expect.poll(raw).toEqual(Array.from(Buffer.from(source.replace("A claim[^note].", "A claim[^note].!"))));
  await editor.press("ControlOrMeta+z"); await expect.poll(raw).toEqual(Array.from(Buffer.from(source)));
});
