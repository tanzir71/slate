import { expect, test } from "./fixtures";
import { openLibrary, chooseAppearance } from "./helpers";
import { libraryFile } from "./libraryFiles";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const original = "\uFEFF# Alpha\r\n\r\n**Original words.**\r\n", beta = "# Beta\n\nBeta words.\n";
async function open(page: Page, path: string) {
  await page.keyboard.press("ControlOrMeta+p"); const quick = page.getByRole("dialog", { name: "Quick open", exact: true });
  await quick.locator("input").fill(path); await quick.getByRole("button").filter({ hasText: path }).click();
  await expect(quick).toBeHidden(); await expect(page.locator(".cm-content")).toBeVisible();
}
async function seed(page: Page) {
  await openLibrary(page); await page.getByLabel("Import files", { exact: true }).setInputFiles([
    { name: "alpha.md", mimeType: "text/markdown", buffer: Buffer.from(original) },
    { name: "beta.md", mimeType: "text/markdown", buffer: Buffer.from(beta) },
  ]);
  await expect(page.locator(".sheetRowContainer strong").filter({ hasText: /^Alpha$/ })).toHaveCount(1);
  await open(page, "alpha.md");
}
async function group(page: Page) {
  const header = page.locator(".headerViewMode"); if (await header.isVisible()) return header;
  const menu = page.locator(".sheetActionsMenu");
  if (!await menu.evaluate(element => element.hasAttribute("open"))) await menu.locator("summary").click();
  return page.locator(".menuViewMode");
}
async function choose(page: Page, name: "Live" | "Source" | "Read") {
  const control = await group(page); await control.getByRole("radio", { name, exact: true }).click();
  await expect(control.getByRole("radio", { name, exact: true })).toHaveAttribute("aria-checked", "true");
  if (await page.locator(".sheetActionsMenu").evaluate(element => element.hasAttribute("open"))) await page.locator(".sheetActionsMenu summary").click();
}
async function bytes(page: Page, path: string, value: string) {
  await expect.poll(() => libraryFile(page, path)).toEqual(Array.from(Buffer.from(value)));
}

test("Mod E cycles the focused editor, preserving raw bytes, cursor and Undo while Read rejects edits", async ({ page }) => {
  await seed(page); const editor = page.locator(".cm-content");
  await editor.press("ControlOrMeta+End"); await page.keyboard.insertText("Draft"); await bytes(page, "alpha.md", original + "Draft");
  await editor.press("ControlOrMeta+e"); await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await expect(editor).toContainText("**Original words.**");
  await page.keyboard.press("ControlOrMeta+e"); await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(editor).toBeFocused();
  await page.keyboard.press("x"); await page.keyboard.press("ControlOrMeta+z"); await bytes(page, "alpha.md", original + "Draft");
  await page.keyboard.press("ControlOrMeta+e"); await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(editor).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z"); await bytes(page, "alpha.md", original);
  await page.keyboard.press("ControlOrMeta+Shift+z"); await bytes(page, "alpha.md", original + "Draft");
  await bytes(page, "beta.md", beta);
});

test("each sheet remembers its mode after switching, closing its tab and reloading", async ({ page }) => {
  await seed(page); await choose(page, "Source"); await open(page, "beta.md"); await choose(page, "Read");
  await page.getByRole("tab", { name: "alpha.md", exact: true }).click(); await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await page.getByRole("button", { name: "Close alpha.md", exact: true }).click(); await open(page, "alpha.md");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible(); await page.reload();
  await expect(page.locator(".cm-lineNumbers")).toBeVisible(); await open(page, "beta.md");
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
  await bytes(page, "alpha.md", original); await bytes(page, "beta.md", beta);
});

test("Tidy temporarily shows Source and restores the remembered mode without writing the sheet", async ({ page }) => {
  await seed(page); await choose(page, "Read"); await page.getByRole("button", { name: "Tidy review", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Tidy review", exact: true })).toBeVisible();
  await expect(page.locator(".cm-lineNumbers")).toBeVisible(); await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
  await page.getByRole("button", { name: "Close Tidy", exact: true }).click();
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0); await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
  const control = await group(page); await expect(control.getByRole("radio", { name: "Read", exact: true })).toHaveAttribute("aria-checked", "true");
  await bytes(page, "alpha.md", original);
});

test("view segments match the light and dark component geometry and support keyboard and touch access", async ({ page }, testInfo) => {
  await seed(page); let control = await group(page); const touch = await page.evaluate(() => matchMedia("(pointer: coarse)").matches || innerWidth <= 1099);
  for (const theme of ["light", "dark"] as const) {
    await chooseAppearance(page, theme); control = await group(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const name of ["Live", "Source", "Read"] as const) {
      await control.getByRole("radio", { name, exact: true }).click();
      const box = await control.boundingBox(); expect(box).not.toBeNull();
      if (!touch) { expect(box!.width).toBe(160); expect(box!.height).toBe(26); }
      else for (const segment of await control.getByRole("radio").all()) {
        const target = await segment.boundingBox(); expect(target!.width).toBeGreaterThanOrEqual(44); expect(target!.height).toBeGreaterThanOrEqual(44);
      }
      const segments = await control.getByRole("radio").evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect(), parent = element.parentElement!.getBoundingClientRect();
        return { left: rect.left - parent.left, right: rect.right - parent.left, width: rect.width };
      }));
      expect(segments[0]!.left).toBe(2); expect(segments[2]!.right).toBe(box!.width - 2);
      if (!touch) expect(segments.map(segment => segment.width)).toEqual([43, 60, 49]);
      await testInfo.attach(`view-mode-${theme}-${name}`, { body: await control.screenshot(), contentType: "image/png" });
    }
  }
  const live = control.getByRole("radio", { name: "Live", exact: true }); await live.focus(); await live.press("ArrowRight");
  await expect(control.getByRole("radio", { name: "Source", exact: true })).toBeFocused();
  await expect(control.getByRole("radio", { name: "Source", exact: true })).toHaveAttribute("aria-checked", "true");
  const result = await new AxeBuilder({ page }).include(".segmentedViewMode").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations.filter(item => item.impact === "critical" || item.impact === "serious")).toEqual([]);
  await bytes(page, "alpha.md", original);
});
