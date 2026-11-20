import { expect, test } from "./fixtures";
import { openLibrary, readCurrentSheet } from "./helpers";

test("the workspace split chord takes priority over matching-bracket navigation", async ({ page }) => {
  await openLibrary(page); await page.keyboard.press("Alt+n");
  const primary = page.getByRole("region", { name: "Primary editor", exact: true }).locator(".cm-content");
  await expect(primary).toBeVisible(); await primary.click(); await primary.press("ControlOrMeta+a");
  await page.keyboard.insertText("()"); await expect(primary).toHaveText("()"); await primary.press("ArrowLeft");
  await page.keyboard.press("ControlOrMeta+Shift+Backslash");
  const secondary = page.getByRole("region", { name: "Secondary editor", exact: true }).locator(".cm-content");
  await expect(secondary).toBeFocused(); await expect(primary).toHaveText("()"); await expect(secondary).toHaveText("()");
  await page.keyboard.press("ControlOrMeta+Shift+Backslash"); await expect(secondary).toHaveCount(0); await expect(primary).toBeFocused();
  await expect.poll(() => readCurrentSheet(page)).toBe("()");
});
