import { expect, test } from "./fixtures";
import { openLibrary } from "./helpers";

const modifier = process.platform === "darwin" ? "Meta" : "Control";

test("keyboard-only walkthrough completes core workspace flows", async ({ page, isMobile }) => {
  test.skip(isMobile, "The keyboard walkthrough targets the desktop workspace layout.");

  await openLibrary(page);

  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeHidden();

  await page.keyboard.press(`${modifier}+K`);
  await expect(palette).toBeVisible();

  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+n");
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(palette).toBeHidden();

  const editor = page.locator(".cm-content");
  // A full keyboard traversal grows with the actual workspace controls, including
  // open/close/split tabs. Allow the browser's chrome stop when focus wraps.
  const stops = await page.locator('button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]').count();
  for (let step = 0; step < stops + 2; step++) {
    if (await editor.evaluate((element) => document.activeElement === element)) break;
    await page.keyboard.press("Tab");
  }
  await expect(editor).toBeFocused();

  await page.keyboard.press(`${modifier}+Shift+F`);
  const search = page.getByRole("dialog", { name: "Search everywhere", exact: true });
  await expect(search.getByRole("textbox", { name: /^Search in / })).toBeFocused();

  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector).toBeHidden();

  await page.keyboard.press(`${modifier}+Shift+I`);
  await expect(inspector).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(search).toBeHidden();
  await expect(page.locator(".cm-content")).toBeFocused();

  await page.keyboard.press(`${modifier}+Shift+I`);
  await expect(inspector).toBeVisible();
  await expect(editor).toBeFocused();
  await page.keyboard.insertText("my words");
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press(`${modifier}+i`);
  await expect(page.locator(".cm-content")).toHaveText("*my words*");
  await expect(inspector).toBeVisible();
  await page.keyboard.press(`${modifier}+z`);
  await expect(page.locator(".cm-content")).toHaveText("my words");
});
