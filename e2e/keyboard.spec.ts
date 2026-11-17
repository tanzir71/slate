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

  await page.keyboard.press(`${modifier}+Shift+F`);
  const sheetSearch = page.getByRole("textbox", { name: "Search sheets" });
  await expect(sheetSearch).toBeFocused();

  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector).toBeHidden();

  await page.keyboard.press(`${modifier}+Shift+I`);
  await expect(inspector).toBeVisible();
  await page.locator(".cm-content").click();
  await page.keyboard.insertText("my words");
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press(`${modifier}+i`);
  await expect(page.locator(".cm-content")).toHaveText("*my words*");
  await expect(inspector).toBeVisible();
  await page.keyboard.press(`${modifier}+z`);
  await expect(page.locator(".cm-content")).toHaveText("my words");
});
