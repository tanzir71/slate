import { expect, test } from "./fixtures";
import { openLibrary, workspaceAction, chooseAppearance } from "./helpers";
import { libraryFile } from "./libraryFiles";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const paragraphs = [
  "Most writing tools ask you to decide where a thought goes before you have finished thinking it. Slate tries to do the opposite.",
  "You open a blank sheet, type a slash, and the structure arrives when you need it — a table, a checklist, a callout — written in plain Markdown you could read in any editor ten years from now.",
  "The page should feel quiet. Everything else can wait until you ask for it",
  "When you are done, Tidy cleans up the syntax, the template fills in the boring parts, and the file is already where it belongs.",
];
const original = "\uFEFF" + paragraphs.join("\r\n\r\n") + "\r\n";
async function seed(page: Page, source = original) {
  await openLibrary(page); await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "zen.md", mimeType: "text/markdown", buffer: Buffer.from(source) });
  const row = page.locator('.browserSheetRow[data-path="zen.md"]'); await expect(row).toHaveCount(1);
  if (await row.isVisible()) await row.click();
  else {
    await page.keyboard.press("ControlOrMeta+p"); const quick = page.getByRole("dialog", { name: "Quick open", exact: true });
    await quick.locator("input").fill("zen.md"); await quick.getByRole("button").filter({ hasText: "zen.md" }).click(); await expect(quick).toBeHidden();
  }
  await expect(page.locator(".cm-content")).toBeVisible();
  const notice = page.getByRole("button", { name: "Dismiss notice", exact: true }); if (await notice.isVisible()) await notice.click();
}
async function focusKind(page: Page, value: "none" | "paragraph" | "sentence") {
  const menu = page.locator(".sheetActionsMenu"); if (!await menu.evaluate(element => element.hasAttribute("open"))) await menu.locator("summary").click();
  await page.getByRole("combobox", { name: "Writing focus", exact: true }).selectOption(value); await menu.locator("summary").click();
}
async function caret(page: Page, word: string) {
  await page.locator(".cm-content:visible").evaluate((element, word) => {
    element.focus(); const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const offset = node.textContent?.indexOf(word) ?? -1;
      if (offset < 0) continue;
      const range = document.createRange(); range.setStart(node, offset + Math.min(2, word.length)); range.collapse(true);
      const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range); return;
    }
    throw Error("Visible writing text not found");
  }, word);
}
async function bytes(page: Page, source: string) { await expect.poll(() => libraryFile(page, "zen.md")).toEqual(Array.from(Buffer.from(source))); }
async function caretDistance(page: Page) {
  return page.locator(".cm-content:visible").evaluate(element => {
    const selection = getSelection(); if (!selection?.rangeCount || !element.contains(selection.anchorNode)) throw Error("Caret is outside the editor");
    const range = selection.getRangeAt(0).cloneRange(); let rect = range.getBoundingClientRect();
    if (!rect.height && range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset) {
      range.setStart(range.startContainer, range.startOffset - 1); rect = range.getBoundingClientRect();
    }
    if (!rect.height && range.startContainer.nodeType === Node.ELEMENT_NODE) {
      // Firefox/WebKit can place the native caret after a text child on its parent.
      const before = range.startOffset > 0;
      let adjacent = range.startContainer.childNodes[before ? range.startOffset - 1 : 0];
      while (adjacent && adjacent.nodeType !== Node.TEXT_NODE) adjacent = (before ? adjacent.lastChild : adjacent.firstChild) ?? undefined;
      const length = adjacent?.textContent?.length ?? 0;
      if (adjacent && length) {
        range.setStart(adjacent, before ? length - 1 : 0); range.setEnd(adjacent, before ? length : 1);
        rect = range.getBoundingClientRect();
      }
    }
    if (!rect.height) {
      const node = range.startContainer, line = (node instanceof Element ? node : node.parentElement)?.closest(".cm-line");
      if (line?.textContent === "") rect = line.getBoundingClientRect();
    }
    if (!rect.height) throw Error("The native caret has no measurable line rectangle");
    const scroller = element.closest(".cm-scroller")!;
    return Math.abs((rect.top + rect.bottom) / 2 - scroller.getBoundingClientRect().top - scroller.clientHeight * .45);
  });
}

test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem("slate.shortcuts.v2", "seen")); });

test("paragraph and sentence focus track native selection while retaining BOM/CRLF source", async ({ page }) => {
  await seed(page); await focusKind(page, "paragraph"); await caret(page, "Everything else");
  const active = page.locator(".cm-line").filter({ hasText: paragraphs[2]! }), inactive = page.locator(".cm-line").filter({ hasText: paragraphs[0]! });
  await expect(inactive).toHaveCSS("opacity", "0.3"); await expect(active).toHaveCSS("opacity", "1");
  await focusKind(page, "sentence"); await caret(page, "Everything else");
  await expect(active.locator(".cm-writing-dim")).toHaveText("The page should feel quiet. ");
  await page.keyboard.press("ControlOrMeta+Period"); await expect(page.locator(".cm-writing-dim")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Period"); await expect(active.locator(".cm-writing-dim")).toHaveText("The page should feel quiet. ");
  await bytes(page, original);
});

test("typewriter centres the real caret at45% on the first and last lines and while typing", async ({ page }) => {
  await seed(page); const editor = page.locator(".cm-content"); await caret(page, "Most writing");
  await workspaceAction(page, "Typewriter mode"); await expect(editor).toBeFocused();
  await expect.poll(() => caretDistance(page)).toBeLessThan(2);
  await editor.press("ControlOrMeta+End"); await expect.poll(() => caretDistance(page)).toBeLessThan(2);
  await page.keyboard.insertText("New words kept."); await expect.poll(() => caretDistance(page)).toBeLessThan(2);
  await bytes(page, original + "New words kept.");
  await page.keyboard.press("ControlOrMeta+z"); await bytes(page, original);
});

test("Zen keeps the active split view and shared Undo while restoring the previous layout on exit", async ({ page }) => {
  await seed(page); await page.getByRole("button", { name: "Split editor", exact: true }).click();
  const active = page.locator('.workspaceEditorPane[data-active="true"] .cm-content'); await expect(active).toBeFocused();
  await active.evaluate(element => element.setAttribute("data-zen-view-identity", "kept"));
  await page.keyboard.press("F11"); await expect(page.locator(".workspaceHeader")).toBeHidden(); await expect(page.locator(".editorTabsBar")).toBeHidden();
  await expect(page.locator('.cm-content:visible')).toHaveCount(1); await expect(page.locator('[data-zen-view-identity="kept"]')).toBeFocused();
  const geometry = await page.locator(".workspaceEditorGrid").evaluate(grid => ({ height: grid.getBoundingClientRect().height, activeHeight: grid.querySelector('.workspaceEditorPane[data-active="true"]')!.getBoundingClientRect().height }));
  expect(Math.abs(geometry.height - geometry.activeHeight)).toBeLessThan(2);
  await page.keyboard.press("ControlOrMeta+End"); await page.keyboard.insertText("Zen draft"); await bytes(page, original + "Zen draft");
  await page.keyboard.press("Escape"); await expect(page.locator(".workspaceHeader")).toBeVisible(); await expect(page.locator(".cm-content:visible")).toHaveCount(2);
  await expect(page.locator('[data-zen-view-identity="kept"]')).toBeFocused(); await page.keyboard.press("ControlOrMeta+z"); await bytes(page, original);
});

test("Escape finishes editor selection handling and then leaves Zen with the file unchanged", async ({ page }) => {
  await seed(page); const editor = page.locator(".cm-content"); await editor.click();
  await editor.press("ControlOrMeta+a"); await expect(page.getByRole("toolbar", { name: "Selection formatting", exact: true })).toBeVisible();
  await editor.press("F11"); await expect(page.locator(".browserWorkspace")).toHaveAttribute("data-zen", "true");
  await editor.press("Escape"); await expect(page.getByRole("toolbar", { name: "Selection formatting", exact: true })).toHaveCount(0);
  await editor.press("Escape"); await expect(page.locator(".workspaceHeader")).toBeVisible();
  await expect(editor).toBeFocused(); await bytes(page, original);
});

for (const theme of ["dark", "light"] as const) test(`Zen HUD uses actual goal data, idles and wakes, and honours reduced motion and touch in ${theme}`, async ({ page }, testInfo) => {
  const words = paragraphs.join(" ").match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g)!.length;
  const source = "\uFEFF---\r\ntitle: Launch plan\r\ngoal: { type: words, target: 1500 }\r\n---\r\n\r\n" + paragraphs.join("\r\n\r\n") + "\r\n".repeat(80) + Array(1184 - words).fill("word").join(" ") + "\r\n";
  await seed(page, source); await chooseAppearance(page, theme); await focusKind(page, "paragraph"); await caret(page, "Everything else");
  await workspaceAction(page, "Typewriter mode"); await page.keyboard.press("F11");
  const workspace = page.locator(".browserWorkspace"), hud = page.getByRole("group", { name: "Writing session", exact: true });
  await expect(hud).toBeVisible(); await expect(hud.locator("svg")).toHaveAttribute("width", "14");
  await expect(page.getByRole("button", { name: "Block actions", exact: true })).toBeHidden();
  await expect(page.locator(".cm-content .cm-line").filter({ hasText: paragraphs[2]! })).toHaveCSS("font-size", "21px");
  await expect(page.locator(".cm-content .cm-line").filter({ hasText: paragraphs[2]! })).toHaveCSS("line-height", "36px");
  await expect(hud.getByRole("img")).toHaveAttribute("aria-label", "1,184 of 1,500 words");
  await expect(hud.locator(".goalRing > span")).toHaveCSS("font-size", "12px");
  await expect(hud.locator(".goalRing > span")).toHaveCSS("line-height", "16px");
  expect(await hud.locator(".goalRing > span").evaluate(element => getComputedStyle(element).fontFamily)).not.toContain("Mono");
  const progress = page.getByRole("progressbar", { name: "Writing goal progress", exact: true });
  await expect(progress).toHaveAttribute("aria-valuemax", "100");
  await expect(progress).toHaveAttribute("aria-valuenow", "79");
  await expect(progress).toHaveAttribute("aria-valuetext", "1184 of 1500 words");
  await expect.poll(() => caretDistance(page)).toBeLessThan(2);
  await workspace.hover({ position: { x: 10, y: 100 } });
  await testInfo.attach(`A8-zen-${theme}`, { body: await page.screenshot(), contentType: "image/png" });
  await expect(workspace).toHaveAttribute("data-zen-hud", "idle"); await expect(hud).toHaveCSS("opacity", "0");
  await workspace.hover({ position: { x: 10, y: 100 } }); await expect(workspace).toHaveAttribute("data-zen-hud", "visible");
  await page.emulateMedia({ reducedMotion: "reduce" }); await expect(hud).toHaveCSS("transition-duration", "0s");
  const touch = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  if (touch) for (const button of await page.locator(".workspaceZenHints button, .workspaceZenHud button").all()) {
    const rect = await button.boundingBox(); expect(rect!.height).toBeGreaterThanOrEqual(44);
  }
  const result = await new AxeBuilder({ page }).include(".workspaceZenHud").include(".workspaceZenHints").include(".workspaceSessionProgress").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations.filter(item => item.impact === "critical" || item.impact === "serious")).toEqual([]);
  await page.keyboard.press("Escape"); await bytes(page, source);
});
