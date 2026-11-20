import { expect, test } from "@playwright/test";
import { nativeFixture } from "./nativeFixture";

test("native Space search reviews real IPC bytes, applies selected notes and undoes after closing", async ({ page }) => {
  const alpha = "\uFEFF# Alpha\r\n\r\nAlpha kept.\r\n", beta = "# Beta\n\nAlpha words.\n";
  await nativeFixture(page, { "alpha.md": alpha, "beta.md": beta }); await page.goto("./");
  await expect(page.locator(".browserWorkspace")).toHaveAttribute("data-editor-ready", "true");
  await page.keyboard.press("ControlOrMeta+Shift+f"); const modal = page.getByRole("dialog", { name: "Search everywhere", exact: true });
  await expect(modal.getByRole("textbox", { name: /^Search in / })).toBeFocused();
  await modal.getByRole("textbox", { name: /^Search in / }).fill("Alpha");
  await expect(modal.getByRole("status")).toHaveText("3 text matches · 2 matching sheets");
  await modal.getByRole("textbox", { name: "Replace with", exact: true }).fill("New");
  await modal.getByRole("button", { name: "Preview replacements", exact: true }).click();
  const preview = modal.getByRole("region", { name: "Replacement preview", exact: true });
  await expect(preview.getByRole("checkbox", { name: /alpha\.md/ })).toBeChecked();
  const bytes = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((key) => key.startsWith("native-file:space:")).map((key) => [key.slice("native-file:space:".length), JSON.parse(localStorage.getItem(key)!) as number[]])));
  expect((await bytes())["alpha.md"]).toEqual(Array.from(Buffer.from(alpha)));
  await preview.getByRole("checkbox", { name: /beta\.md/ }).uncheck(); await modal.getByRole("button", { name: "Apply 2 replacements", exact: true }).click();
  await expect(preview.getByText("Applied", { exact: true })).toBeVisible();
  const saved = await bytes(); expect(saved["alpha.md"]).toEqual(Array.from(Buffer.from(alpha.split("Alpha").join("New")))); expect(saved["beta.md"]).toEqual(Array.from(Buffer.from(beta)));
  expect(Object.entries(saved).find(([path]) => path.startsWith(".slate/history/") && path.endsWith("/alpha.md"))?.[1]).toEqual(Array.from(Buffer.from(alpha)));
  await modal.getByRole("button", { name: "Close Search everywhere", exact: true }).click();
  await page.getByRole("button", { name: "Sheet actions", exact: true }).click(); await page.getByRole("button", { name: "Undo replacements", exact: true }).click();
  await expect.poll(async () => (await bytes())["alpha.md"]).toEqual(Array.from(Buffer.from(alpha)));
});
