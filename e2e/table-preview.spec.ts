import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { chooseAppearance, openLibrary, showSheets } from "./helpers";
import { libraryFile } from "./libraryFiles";
import { tableFileSource } from "./tablePreviewFixture";

async function saved(page: Page, source: string) {
  await expect(async () => {
    expect(await libraryFile(page, "Table.md")).toEqual(Array.from(Buffer.from(source)));
  }).toPass({ timeout: 5_000 });
}
async function imported(page: Page, source: string) {
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "Table.md", mimeType: "text/markdown", buffer: Buffer.from(source) });
  await expect(page.locator(".cm-slate-table-grid")).toBeVisible();
}

test("table grids retain exact BOM and CRLF through themed preview, native cell selection, editing and one Undo", async ({ page }, testInfo) => {
  await imported(page, tableFileSource);
  const grid = page.locator(".cm-slate-table-grid"), editor = page.locator(".cm-content");
  await expect(grid.getByRole("row")).toHaveCount(4);
  await expect(grid.getByRole("columnheader")).toHaveText(["Phase", "Scope", "Target"]);
  for (const theme of ["light", "dark"] as const) {
    await chooseAppearance(page, theme);
    const geometry = await grid.evaluate(element => {
      const first = element.querySelector('[role="columnheader"]')!, body = element.querySelector('[role="cell"]')!;
      const text = document.createTreeWalker(first, NodeFilter.SHOW_TEXT).nextNode()!;
      const headerStyle = getComputedStyle(text.parentElement!), bodyStyle = getComputedStyle(body), style = getComputedStyle(element);
      return { height: element.getBoundingClientRect().height, border: style.borderLeftWidth, radius: style.borderTopLeftRadius,
        header: { font: headerStyle.fontFamily, size: headerStyle.fontSize, weight: headerStyle.fontWeight, lineHeight: headerStyle.lineHeight },
        body: { size: bodyStyle.fontSize, lineHeight: bodyStyle.lineHeight },
        columns: Array.from(element.querySelectorAll('[role="columnheader"]'), cell => cell.getBoundingClientRect().width) };
    });
    expect(geometry).toMatchObject({ height: 157, border: "1px", radius: "8px", header: { size: "12px", weight: "500", lineHeight: "16px" }, body: { size: "13px", lineHeight: "20px" } });
    expect(geometry.header.font).toContain("Geist");
    expect(geometry.columns.slice(0, 2)).toEqual([160, 340]);
    await saved(page, tableFileSource);
    const path = testInfo.outputPath(`table-${theme}.png`);
    await grid.screenshot({ path, animations: "disabled" });
    await testInfo.attach(`table-${theme}`, { path, contentType: "image/png" });
  }
  const overflow = await page.locator(".cm-scroller").evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }));
  expect(overflow.content).toBeLessThanOrEqual(overflow.width);
  const scrollable = await grid.evaluate(element => element.scrollWidth > element.clientWidth);
  await grid.focus();
  await expect(grid).toBeFocused();
  if (scrollable) {
    await grid.press("ArrowRight");
    await expect.poll(() => grid.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  }
  await grid.press("Tab");
  await expect(grid).not.toBeFocused();
  await expect(grid).toBeVisible();
  await saved(page, tableFileSource);
  const accessibility = await new AxeBuilder({ page }).include(".browserEditor").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  await grid.getByRole("cell", { name: "Beta", exact: true }).click();
  await expect(grid).toHaveCount(0);
  await expect(editor).toBeFocused();
  await saved(page, tableFileSource);
  await editor.press("Home");
  await editor.press("ArrowRight");
  await editor.press("ArrowRight");
  await page.keyboard.insertText("New ");
  await saved(page, tableFileSource.replace("| Beta |", "| New Beta |"));
  await editor.press("ControlOrMeta+z");
  await saved(page, tableFileSource);
  await editor.press("ControlOrMeta+End");
  await expect(grid.getByRole("cell", { name: "Beta", exact: true })).toBeVisible();
});

test("grid cells retain inline formatting and ordinary external and wiki-link navigation", async ({ page, context }) => {
  const source = "# Table\n\n| Name | Link | Notes |\n|---|---|---|\n| **Bold** | [site](https://example.test/table) | [[Target\\|alias]] &amp; |\n\nActive.";
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles([
    { name: "Table.md", mimeType: "text/markdown", buffer: Buffer.from(source) },
    { name: "Target.md", mimeType: "text/markdown", buffer: Buffer.from("# Target\n\nKept words.") },
  ]);
  await expect(page.locator(".notice").filter({ hasText: "Imported your files. Existing files were kept." })).toBeVisible();
  await expect(page.locator(".browserWorkspace")).toHaveAttribute("data-editor-ready", "true");
  if (!page.url().endsWith("/Table.md")) {
    await showSheets(page);
    await page.locator('.browserSheetRow[data-path="Table.md"]').click();
  }
  await expect(page).toHaveURL(/\/Table\.md$/);
  await saved(page, source);
  expect(await libraryFile(page, "Target.md")).toEqual(Array.from(Buffer.from("# Target\n\nKept words.")));
  const grid = page.locator(".cm-slate-table-grid");
  await expect(grid.locator(".cm-slate-strong")).toHaveText("Bold");
  await expect(grid.locator(".cm-slate-wiki-link")).toHaveText("alias");
  await expect(grid.getByRole("cell").last()).toHaveText("alias &");
  await context.route("https://example.test/**", route => route.fulfill({ contentType: "text/html", body: "<h1>Opened safely</h1>" }));
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  const popupPromise = page.waitForEvent("popup");
  await grid.locator(".cm-slate-link").click({ modifiers: [modifier] });
  const popup = await popupPromise;
  await expect(popup).toHaveURL("https://example.test/table");
  await popup.close();
  await saved(page, source);
  await grid.locator(".cm-slate-wiki-link").click({ modifiers: [modifier] });
  await expect(page).toHaveURL(/Target\.md$/);
  await expect(page.locator(".cm-content")).toContainText("Kept words.");
  await saved(page, source);
});

test("empty cells open source and nested callout tables keep their frame without changing files", async ({ page }) => {
  const source = "# Nested\n\n> [!NOTE] Table\n>\n> | A | B |\n> |---|---|\n> || value |\n\nActive.";
  await imported(page, source);
  const grid = page.locator(".cm-slate-callout-container .cm-slate-table-grid");
  await expect(grid).toHaveCount(1);
  await expect(grid.getByRole("cell")).toHaveText(["", "value"]);
  await grid.getByRole("cell").first().click();
  await expect(page.locator(".cm-slate-table-grid")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toBeFocused();
  await saved(page, source);
  await page.locator(".cm-content").press("ControlOrMeta+End");
  await expect(grid.getByRole("cell")).toHaveText(["", "value"]);
  await saved(page, source);
});
