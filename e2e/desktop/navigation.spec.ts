import { expect, test } from "@playwright/test";
import { nativeFixture } from "./nativeFixture";

test("native back and forward preserve failed drafts and re-read destination bytes through IPC", async ({ page }) => {
  const alpha = "\uFEFF# Alpha\r\n\r\nOriginal words.\r\n";
  await nativeFixture(page, { "alpha.md": alpha, "beta.md": "Beta" }); await page.goto("./");
  await expect(page.locator(".browserWorkspace")).toHaveAttribute("data-editor-ready", "true");
  await page.keyboard.press("ControlOrMeta+p");
  const quick = page.getByRole("dialog", { name: "Quick open", exact: true });
  await quick.locator("input").fill("beta.md");
  await quick.getByRole("button").filter({ hasText: "beta.md" }).click();
  await expect(page).toHaveURL(/\/sheet\/beta\.md$/);
  await page.evaluate(() => localStorage.setItem("native-fail-save", "true"));
  await page.locator(".cm-content").fill("Draft kept through IPC");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByRole("alert")).toContainText("Disk is read-only");
  await expect(page).toHaveURL(/\/sheet\/beta\.md$/);
  await expect(page.locator(".cm-content")).toHaveText("Draft kept through IPC");
  const external = "\uFEFF# Alpha outside\r\n\r\nExternal kept.\r\n";
  await page.evaluate((source) => {
    localStorage.removeItem("native-fail-save");
    localStorage.setItem("native-file:space:alpha.md", JSON.stringify(Array.from(new TextEncoder().encode(source))));
  }, external);
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page).toHaveURL(/\/sheet\/alpha\.md$/);
  await expect(page.locator(".cm-content")).toContainText("External kept.");
  await expect(page.locator(".cm-content")).toBeFocused();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("native-file:space:beta.md")!) as number[])).toEqual(Array.from(Buffer.from("Draft kept through IPC")));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("native-file:space:alpha.md")!) as number[])).toEqual(Array.from(Buffer.from(external)));
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page).toHaveURL(/\/sheet\/beta\.md$/);
  await expect(page.locator(".cm-content")).toHaveText("Draft kept through IPC");
  await expect(page.locator(".cm-content")).toBeFocused();
});
