import { expect, test } from "@playwright/test";

const modifier = process.platform === "darwin" ? "Meta" : "Control";

test("keyboard-only walkthrough completes core workspace flows", async ({ page, isMobile }) => {
  test.skip(isMobile, "The keyboard walkthrough targets the desktop workspace layout.");

  await page.goto("/");

  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();

  await page.keyboard.press(`${modifier}+K`);
  await expect(palette).toBeVisible();
  await expect(page.getByPlaceholder("Search Everything")).toBeFocused();

  await page.keyboard.press("Escape");
  await page.keyboard.press(`${modifier}+N`);
  await expect(page.getByRole("heading", { name: "Untitled Sheet" })).toBeVisible();
  await expect(palette).toBeHidden();

  await page.keyboard.press(`${modifier}+Shift+F`);
  const sheetSearch = page.getByPlaceholder("Search sheets...");
  await expect(sheetSearch).toBeFocused();

  await page.keyboard.type("research");
  const researchSheet = page.getByRole("button", { name: /User Research Synthesis/ });
  await expect(researchSheet).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(researchSheet).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "User Research Synthesis" })).toBeVisible();

  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector).toBeVisible();

  await page.keyboard.press(`${modifier}+I`);
  await expect(inspector).toBeHidden();

  await page.keyboard.press(`${modifier}+I`);
  await expect(inspector).toBeVisible();
  await expect(page.getByRole("tab", { name: "Backlinks" })).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Outline" })).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press(`${modifier}+.`);
  await expect(page.locator("main")).toHaveClass(/focusMode/);

  await page.keyboard.press(`${modifier}+.`);
  await expect(page.locator("main")).not.toHaveClass(/focusMode/);

  await page.keyboard.press(`${modifier}+Alt+2`);
  await expect(page.getByRole("button", { name: "Blog" })).toHaveAttribute("aria-current", "true");
});
