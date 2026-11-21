import { expect, test } from "./fixtures";
import { openLibrary, workspaceAction } from "./helpers";
import { libraryFile } from "./libraryFiles";
import { editorSource } from "./editorSource";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const alpha = "\uFEFF# Alpha\r\n\r\nOriginal words.\r\n", beta = "# Beta\r\n\r\nBeta words.\r\n";
const tab = (page: Page, path: string) => page.getByRole("tab", { name: path, exact: true });
const pane = (page: Page, id: "Primary" | "Secondary") => page.getByRole("region", { name: `${id} editor`, exact: true });
async function open(page: Page, path: string) {
  await page.keyboard.press("ControlOrMeta+p"); const dialog = page.getByRole("dialog", { name: "Quick open", exact: true });
  await dialog.locator("input").fill(path); await dialog.getByRole("button").filter({ hasText: path }).click();
  await expect(dialog).toBeHidden(); await expect(page).toHaveURL(new RegExp(`/sheet/${path.replace(".", "\\.")}$`));
  const bytes = await libraryFile(page, path);
  expect(bytes).toBeDefined();
  const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(new Uint8Array(bytes!)).replace(/\r\n?/g, "\n");
  const editor = page.locator('.workspaceEditorPane[data-active="true"] .cm-content');
  await expect.poll(() => editorSource(editor)).toBe(source);
  // Creation delivers its ready/focus callback on the next frame, after mounting the buffer.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(editor).toBeFocused();
}
async function seed(page: Page) {
  await openLibrary(page); await page.getByLabel("Import files", { exact: true }).setInputFiles([
    { name: "alpha.md", mimeType: "text/markdown", buffer: Buffer.from(alpha) },
    { name: "beta.md", mimeType: "text/markdown", buffer: Buffer.from(beta) },
  ]);
  await expect(page.locator(".sheetRowContainer strong").filter({ hasText: /^Alpha$/ })).toHaveCount(1);
  await expect(page.locator(".sheetRowContainer strong").filter({ hasText: /^Beta$/ })).toHaveCount(1);
  await open(page, "alpha.md");
}
async function bytes(page: Page, path: string, source: string) {
  await expect(async () => expect(await libraryFile(page, path)).toEqual(Array.from(Buffer.from(source)))).toPass({ timeout: 5_000 });
}

test("tabs retain per-file Undo after switching, closing and reopening without changing raw bytes", async ({ page }) => {
  await seed(page); await expect(tab(page, "alpha.md")).toHaveAttribute("aria-selected", "true");
  let editor = pane(page, "Primary").locator(".cm-content"); await editor.press("ControlOrMeta+End"); await page.keyboard.insertText("Alpha draft");
  await bytes(page, "alpha.md", alpha + "Alpha draft"); await open(page, "beta.md");
  await expect(tab(page, "alpha.md")).toHaveAttribute("aria-selected", "false");
  await expect(tab(page, "beta.md")).toHaveAttribute("aria-selected", "true"); await tab(page, "alpha.md").click();
  editor = pane(page, "Primary").locator(".cm-content"); await editor.press("ControlOrMeta+z"); await bytes(page, "alpha.md", alpha);
  await editor.press("ControlOrMeta+Shift+z"); await bytes(page, "alpha.md", alpha + "Alpha draft");
  await page.getByRole("button", { name: "Close alpha.md", exact: true }).click(); await expect(tab(page, "alpha.md")).toHaveCount(0);
  await bytes(page, "alpha.md", alpha + "Alpha draft"); await open(page, "alpha.md");
  await pane(page, "Primary").locator(".cm-content").press("ControlOrMeta+z"); await bytes(page, "alpha.md", alpha); await bytes(page, "beta.md", beta);
});

test("same-file split views synchronize input and use one history from either pane", async ({ page }) => {
  await seed(page); await page.getByRole("button", { name: "Split editor", exact: true }).click();
  const left = pane(page, "Primary").locator(".cm-content"), right = pane(page, "Secondary").locator(".cm-content");
  await expect(left).toBeVisible(); await expect(right).toBeVisible(); await left.click(); await left.press("ControlOrMeta+End");
  await page.keyboard.insertText("Shared words"); await expect(right).toContainText("Shared words"); await bytes(page, "alpha.md", alpha + "Shared words");
  await right.click(); await right.press("ControlOrMeta+z"); await expect(left).not.toContainText("Shared words"); await bytes(page, "alpha.md", alpha);
  await left.click(); await left.press("ControlOrMeta+Shift+z"); await expect(right).toContainText("Shared words"); await bytes(page, "alpha.md", alpha + "Shared words");
  await page.getByRole("button", { name: "Close split", exact: true }).click(); await expect(page.locator(".cm-content")).toHaveCount(1);
  await bytes(page, "beta.md", beta);
});

test("different-file panes route focused palette commands and saves to their own document", async ({ page }) => {
  await seed(page); await page.getByRole("button", { name: "Split editor", exact: true }).click(); await open(page, "beta.md");
  const left = pane(page, "Primary").locator(".cm-content"), right = pane(page, "Secondary").locator(".cm-content");
  await expect(left).toContainText("Original words."); await expect(right).toContainText("Beta words.");
  await left.click(); await expect(page).toHaveURL(/\/sheet\/alpha\.md$/); await left.press("ControlOrMeta+End"); await page.keyboard.insertText("target");
  for (let index = 0; index < 6; index++) await page.keyboard.press("Shift+ArrowLeft");
  await workspaceAction(page, "Command palette"); const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
  await palette.locator("input").fill("> bold"); await palette.getByRole("button", { name: "Bold", exact: true }).click();
  await bytes(page, "alpha.md", alpha + "**target**"); await bytes(page, "beta.md", beta);
  await right.click(); await expect(page).toHaveURL(/\/sheet\/beta\.md$/); await right.press("ControlOrMeta+End"); await page.keyboard.insertText("Only Beta");
  await bytes(page, "beta.md", beta + "Only Beta"); await bytes(page, "alpha.md", alpha + "**target**");
});

test("closing every tab leaves the files intact and a usable empty editor", async ({ page }) => {
  await seed(page); await open(page, "beta.md"); const tabs = page.getByRole("tablist", { name: "Open sheets", exact: true });
  await expect(tabs).toBeVisible();
  while (await tabs.getByRole("tab").count()) {
    const path = await tabs.getByRole("tab").last().getAttribute("aria-label"); expect(path).toBeTruthy();
    await page.getByRole("button", { name: `Close ${path}`, exact: true }).click();
  }
  await expect(page.locator(".cm-content")).toHaveCount(0); await expect(page.getByRole("heading", { name: "A fresh page awaits.", exact: true })).toBeVisible();
  await bytes(page, "alpha.md", alpha); await bytes(page, "beta.md", beta);
  await open(page, "alpha.md"); await expect(pane(page, "Primary").locator(".cm-content")).toContainText("Original words.");
});

test("quick open can send a sheet to a new split without replacing the original pane", async ({ page }) => {
  await seed(page); await page.keyboard.press("ControlOrMeta+p"); const quick = page.getByRole("dialog", { name: "Quick open", exact: true });
  await quick.locator("input").fill("beta.md"); await expect(quick.getByRole("button").filter({ hasText: "beta.md" })).toBeVisible();
  await quick.locator("input").press("ControlOrMeta+Enter"); await expect(quick).toBeHidden();
  await expect(pane(page, "Primary").locator(".cm-content")).toContainText("Original words.");
  await expect(pane(page, "Secondary").locator(".cm-content")).toContainText("Beta words.");
  await bytes(page, "alpha.md", alpha); await bytes(page, "beta.md", beta);
});

test("tab arrow navigation keeps keyboard focus in the tab list after the editor is ready", async ({ page }) => {
  await seed(page); await open(page, "beta.md"); await tab(page, "beta.md").focus(); await tab(page, "beta.md").press("Home");
  await expect(pane(page, "Primary").locator(".cm-content")).toContainText("Original words.");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(tab(page, "alpha.md")).toBeFocused(); await expect(tab(page, "alpha.md")).toHaveAttribute("aria-selected", "true");
  await tab(page, "alpha.md").press("ArrowRight"); await expect(pane(page, "Primary").locator(".cm-content")).toContainText("Beta words.");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(tab(page, "beta.md")).toBeFocused(); await bytes(page, "alpha.md", alpha); await bytes(page, "beta.md", beta);
});

test("tabs and split panes expose accessible names, relationships and controls", async ({ page }) => {
  await seed(page); await page.getByRole("button", { name: "Split editor", exact: true }).click(); await expect(pane(page, "Secondary").locator(".cm-content")).toBeVisible();
  const results = await new AxeBuilder({ page }).include(".editorTabsBar").include(".workspaceEditorGrid").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")).toEqual([]);
});

test("tab controls retain touch targets and split panes fit the available viewport", async ({ page }, testInfo) => {
  await seed(page); const touch = await page.evaluate(() => matchMedia("(pointer: coarse)").matches || innerWidth <= 699), minimum = touch ? 44 : 28;
  for (const label of ["Close alpha.md", "Open sheet in tab", "Split editor"]) {
    const box = await page.getByRole("button", { name: label, exact: true }).boundingBox(); expect(box?.width).toBeGreaterThanOrEqual(minimum); expect(box?.height).toBeGreaterThanOrEqual(minimum);
  }
  expect((await page.locator(".tabGlyph--close").first().boundingBox())?.width).toBe(12);
  expect((await page.locator(".tabGlyph--file").first().boundingBox())?.width).toBe(16);
  const lastTab = await page.getByRole("tablist", { name: "Open sheets", exact: true }).getByRole("tab").last().boundingBox();
  const add = await page.getByRole("button", { name: "Open sheet in tab", exact: true }).boundingBox();
  expect(lastTab).toBeTruthy(); expect(add).toBeTruthy(); const gap = add!.x - lastTab!.x - lastTab!.width;
  await testInfo.attach("tab-action-placement", { body: JSON.stringify({ lastTab, add, gap }), contentType: "application/json" });
  expect(gap).toBeGreaterThanOrEqual(0); expect(gap).toBeLessThanOrEqual(8);
  await page.getByRole("button", { name: "Split editor", exact: true }).click();
  const left = await pane(page, "Primary").boundingBox(), right = await pane(page, "Secondary").boundingBox(), width = await page.evaluate(() => innerWidth);
  expect(left).toBeTruthy(); expect(right).toBeTruthy();
  if (width <= 699) expect(right!.y).toBeGreaterThanOrEqual(left!.y + left!.height - 1);
  else expect(right!.x).toBeGreaterThanOrEqual(left!.x + left!.width - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
});

test("workspace tab shortcuts open, cycle, close and reopen notes with retained Undo", async ({ page }) => {
  await seed(page); await page.keyboard.press("Alt+t");
  const quick = page.getByRole("dialog", { name: "Quick open", exact: true });
  await expect(quick.locator("input")).toBeFocused(); await quick.locator("input").fill("beta.md"); await quick.locator("input").press("Enter");
  await expect(quick).toBeHidden(); await expect(tab(page, "beta.md")).toHaveAttribute("aria-selected", "true");
  const editor = pane(page, "Primary").locator(".cm-content"); await expect(editor).toBeFocused();
  await editor.press("ControlOrMeta+End"); await page.keyboard.insertText("Keyboard Beta"); await bytes(page, "beta.md", beta + "Keyboard Beta");
  await page.keyboard.press("Alt+]"); await expect(tab(page, "alpha.md")).toHaveAttribute("aria-selected", "true"); await expect(editor).toBeFocused();
  await page.keyboard.press("Alt+["); await expect(tab(page, "beta.md")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Alt+w"); await expect(tab(page, "beta.md")).toHaveCount(0); await bytes(page, "beta.md", beta + "Keyboard Beta");
  await page.keyboard.press("Alt+Shift+t"); await expect(tab(page, "beta.md")).toHaveAttribute("aria-selected", "true"); await expect(editor).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z"); await bytes(page, "beta.md", beta);
  await page.keyboard.press("Alt+w"); await page.keyboard.press("Alt+w"); await expect(page.locator(".cm-content")).toHaveCount(0);
  await page.keyboard.press("Alt+Shift+t"); await expect(tab(page, "alpha.md")).toHaveAttribute("aria-selected", "true");
  await expect(pane(page, "Primary").locator(".cm-content")).toBeFocused(); await bytes(page, "alpha.md", alpha); await bytes(page, "beta.md", beta);
});

test("split and tab shortcuts target the focused pane and respect modal and composition scopes", async ({ page }) => {
  await seed(page); await open(page, "beta.md"); await page.keyboard.press("ControlOrMeta+Shift+Backslash");
  await expect(pane(page, "Secondary").locator(".cm-content")).toBeFocused(); await open(page, "alpha.md");
  await page.keyboard.press("Alt+]"); await expect(pane(page, "Primary").locator(".cm-content")).toContainText("Beta words.");
  await expect(pane(page, "Secondary").locator(".cm-content")).toContainText("Beta words.");
  await page.keyboard.press("Alt+["); await expect(pane(page, "Secondary").locator(".cm-content")).toContainText("Original words.");
  await page.keyboard.press("ControlOrMeta+k"); const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
  await expect(palette.locator("input")).toBeFocused();
  await page.keyboard.press("Alt+w"); await page.keyboard.press("Alt+Shift+t"); await page.keyboard.press("ControlOrMeta+Shift+Backslash");
  await expect(palette).toBeVisible(); await expect(page.getByRole("tablist", { name: "Open sheets", exact: true }).getByRole("tab")).toHaveCount(2);
  await expect(pane(page, "Secondary")).toHaveCount(1); await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const target = document.activeElement!;
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "w", code: "KeyW", altKey: true, isComposing: true, bubbles: true, cancelable: true }));
    const altGr = new KeyboardEvent("keydown", { key: "w", code: "KeyW", altKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(altGr, "getModifierState", { value: (key: string) => key === "AltGraph" }); target.dispatchEvent(altGr);
  });
  await expect(tab(page, "alpha.md")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ControlOrMeta+Shift+Backslash"); await expect(pane(page, "Secondary")).toHaveCount(0);
  await expect(pane(page, "Primary").locator(".cm-content")).toBeFocused();
  await expect(pane(page, "Primary").locator(".cm-content")).toContainText("Original words."); await bytes(page, "alpha.md", alpha); await bytes(page, "beta.md", beta);
});
