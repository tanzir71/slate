import { expect, test, type Page } from "@playwright/test";
import { nativeFixture } from "./nativeFixture";

const alpha = "\uFEFF# Alpha\r\n\r\nOriginal words.\r\n", beta = "# Beta\r\n\r\nBeta words.\r\n";
const pane = (page: Page, name: "Primary" | "Secondary") => page.getByRole("region", { name: `${name} editor`, exact: true }).locator(".cm-content");
async function raw(page: Page, path: string) {
  return page.evaluate((path) => JSON.parse(localStorage.getItem(`native-file:space:${path}`) ?? "null") as number[] | null, path);
}
test.beforeEach(async ({ page }) => {
  await nativeFixture(page, { "alpha.md": alpha, "beta.md": beta }); await page.goto("./");
  await expect(pane(page, "Primary")).toBeVisible(); await expect(page.getByRole("tab", { name: "alpha.md", exact: true })).toBeVisible();
});

test("native tab shortcuts use native chords and preserve focused-file IPC bytes", async ({ page }) => {
  await pane(page, "Primary").press("ControlOrMeta+t"); const quick = page.getByRole("dialog", { name: "Quick open", exact: true });
  await expect(quick.locator("input")).toBeFocused(); await quick.locator("input").fill("beta.md"); await quick.locator("input").press("Enter");
  await expect(quick).toBeHidden(); await expect(page.getByRole("tab", { name: "beta.md", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Control+Tab"); await expect(page.getByRole("tab", { name: "alpha.md", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Control+Shift+Tab"); await expect(page.getByRole("tab", { name: "beta.md", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ControlOrMeta+w"); await expect(page.getByRole("tab", { name: "beta.md", exact: true })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+t"); await expect(page.getByRole("tab", { name: "beta.md", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ControlOrMeta+Shift+Backslash"); await expect(pane(page, "Secondary")).toBeFocused();
  await pane(page, "Secondary").press("ControlOrMeta+End"); await page.keyboard.insertText("Native keyboard");
  await expect.poll(() => raw(page, "beta.md")).toEqual(Array.from(Buffer.from(beta + "Native keyboard")));
  await pane(page, "Primary").press("ControlOrMeta+z"); await expect.poll(() => raw(page, "beta.md")).toEqual(Array.from(Buffer.from(beta)));
  expect(await raw(page, "alpha.md")).toEqual(Array.from(Buffer.from(alpha)));
});

test("native split views save shared input and cross-pane Undo/Redo as exact IPC bytes", async ({ page }) => {
  await page.getByRole("button", { name: "Split editor", exact: true }).click(); const left = pane(page, "Primary"), right = pane(page, "Secondary");
  await expect(right).toBeVisible(); await left.click(); await left.press("ControlOrMeta+End"); await page.keyboard.insertText("Shared native words");
  await expect(right).toContainText("Shared native words"); await expect.poll(() => raw(page, "alpha.md")).toEqual(Array.from(Buffer.from(alpha + "Shared native words")));
  await right.click(); await right.press("ControlOrMeta+z"); await expect.poll(() => raw(page, "alpha.md")).toEqual(Array.from(Buffer.from(alpha)));
  await left.click(); await left.press("ControlOrMeta+Shift+z"); await expect(right).toContainText("Shared native words");
  await expect.poll(() => raw(page, "alpha.md")).toEqual(Array.from(Buffer.from(alpha + "Shared native words")));
  expect(await raw(page, "beta.md")).toEqual(Array.from(Buffer.from(beta)));
});

test("native pane focus and reopening tabs preserve file identity and document Undo", async ({ page }) => {
  await page.getByRole("button", { name: "Split editor", exact: true }).click(); await page.keyboard.press("ControlOrMeta+p");
  const quick = page.getByRole("dialog", { name: "Quick open", exact: true }); await quick.locator("input").fill("beta.md");
  await quick.getByRole("button").filter({ hasText: "beta.md" }).click(); await expect(quick).toBeHidden();
  const left = pane(page, "Primary"), right = pane(page, "Secondary"); await expect(right).toContainText("Beta words.");
  await left.click(); await left.press("ControlOrMeta+End"); await page.keyboard.insertText("Only Alpha");
  await expect.poll(() => raw(page, "alpha.md")).toEqual(Array.from(Buffer.from(alpha + "Only Alpha")));
  await right.click(); await right.press("ControlOrMeta+End"); await page.keyboard.insertText("Only Beta");
  await expect.poll(() => raw(page, "beta.md")).toEqual(Array.from(Buffer.from(beta + "Only Beta")));
  await page.getByRole("button", { name: "Close alpha.md", exact: true }).click(); expect(await raw(page, "alpha.md")).toEqual(Array.from(Buffer.from(alpha + "Only Alpha")));
  await page.keyboard.press("ControlOrMeta+p"); await quick.locator("input").fill("alpha.md"); await quick.getByRole("button").filter({ hasText: "alpha.md" }).click();
  await expect(quick).toBeHidden(); const editor = page.getByRole("region", { name: "Secondary editor", exact: true }).locator(".cm-content");
  await editor.press("ControlOrMeta+z"); await expect.poll(() => raw(page, "alpha.md")).toEqual(Array.from(Buffer.from(alpha)));
  expect(await raw(page, "beta.md")).toEqual(Array.from(Buffer.from(beta + "Only Beta")));
});
