import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { createSheet, openLibrary } from "./helpers";

async function caretPosition(page: Page) {
  return page.evaluate(() => {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const line = (node instanceof Element ? node : node?.parentElement)?.closest(".cm-line");
    if (!selection || !node || !line) return null;
    const range = document.createRange();
    range.selectNodeContents(line);
    range.setEnd(node, selection.anchorOffset);
    return { line: line.textContent, offset: range.toString().length };
  });
}

test("reopen restores the selected sheet, caret, scroll and inspector preference", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLibrary(page);
  const editor = await createSheet(page, Array.from({ length: 100 }, (_, index) => `Line ${String(index).padStart(3, "0")} - words worth keeping.`).join("\n"));
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector).toBeHidden();
  await page.getByRole("button", { name: "Toggle inspector" }).click();
  await expect(inspector).toBeVisible();
  await editor.focus();
  for (let index = 0; index < 10; index++) await page.keyboard.press("ArrowUp");
  for (let index = 0; index < 6; index++) await page.keyboard.press("ArrowLeft");
  const caret = await caretPosition(page);
  expect(caret?.line).toMatch(/^Line \d{3} - /);
  expect(caret?.offset).toBeGreaterThan(0);
  const scroller = page.locator(".cm-scroller");
  await scroller.evaluate(async (element) => {
    element.scrollTop = 350;
    await new Promise(requestAnimationFrame);
  });
  const scroll = await scroller.evaluate((element) => element.scrollTop);
  expect(scroll).toBeGreaterThan(300);
  const before = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith("slate.editor."))));
  await page.reload();
  await expect(inspector).toBeVisible();
  await expect(editor).toBeVisible();
  try {
    await expect.poll(() => scroller.evaluate((element) => Math.abs(element.scrollTop - 350))).toBeLessThanOrEqual(28);
  } finally {
    const after = await page.evaluate(() => ({ positions: Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith("slate.editor."))), scroll: document.querySelector(".cm-scroller")?.scrollTop }));
    console.log(`View restore (${testInfo.project.name}): ${JSON.stringify({ before, after })}`);
  }
  await editor.focus();
  await expect.poll(() => caretPosition(page)).toEqual(caret);
  await page.getByRole("button", { name: "Toggle inspector" }).click();
  await page.reload();
  await expect(editor).toBeVisible();
  await expect(inspector).toBeHidden();
});
