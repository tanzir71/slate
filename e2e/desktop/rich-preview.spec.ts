import { expect, test } from "@playwright/test";
import { nativeFixture } from "./nativeFixture";

test("compiled desktop runs lazy math and isolated diagrams under production CSP and preserves IPC bytes and Undo", async ({ page }) => {
  const source = "\uFEFF# Rich\r\n\r\nInline $x_i$.\r\n\r\n$$\r\n\\frac{a}{b}\r\n$$\r\n\r\n```mermaid\r\nflowchart LR\r\n A[Writing] --> B[Files]\r\n```\r\n\r\nActive.\r\n";
  await nativeFixture(page, { "rich.md": source }); await page.goto("./");
  await expect(page.frameLocator('iframe[title="Math preview"]').nth(1).locator("mfrac")).toBeVisible();
  await expect(page.frameLocator('iframe[title="Diagram preview"]').getByText("Files", { exact: true })).toBeVisible();
  await expect(page.locator('iframe[title="Diagram preview"]')).toHaveAttribute("sandbox", "");
  const raw = () => page.evaluate(() => JSON.parse(localStorage.getItem("native-file:space:rich.md") ?? "null") as number[] | null);
  await expect.poll(raw).toEqual(Array.from(Buffer.from(source)));
  const button = page.getByRole("button", { name: "Show math source", exact: true }).first(); await button.focus(); await button.press("Enter");
  const editor = page.locator(".cm-content"); await expect(editor).toBeFocused(); await page.keyboard.insertText("z+");
  await expect.poll(raw).toEqual(Array.from(Buffer.from(source.replace("$x_i$", "$z+x_i$"))));
  await editor.press("ControlOrMeta+z"); await expect.poll(raw).toEqual(Array.from(Buffer.from(source)));
  await editor.press("ControlOrMeta+End"); await page.reload();
  await expect(page.frameLocator('iframe[title="Math preview"]').nth(1).locator("mfrac")).toBeVisible();
  await expect(page.frameLocator('iframe[title="Diagram preview"]').locator("svg")).toBeVisible(); await expect.poll(raw).toEqual(Array.from(Buffer.from(source)));
});
