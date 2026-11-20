import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { chooseAppearance, openLibrary, workspaceAction } from "./helpers";
import { libraryFile } from "./libraryFiles";
import type { Page } from "@playwright/test";

const alpha = "\uFEFF# Alpha\r\n\r\nKeep words. Alpha.\r\n";
const beta = "# Beta\n\nAlpha words. বাংলা. <script>keep</script>\n";
const third = "# Third\n\nDifferent words.\n";
const modal = (page: Page) => page.getByRole("dialog", { name: "Search everywhere", exact: true });
const queryInput = (page: Page) => modal(page).getByRole("textbox", { name: /^Search in / });
async function seed(page: Page) {
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles([
    { name: "alpha.md", mimeType: "text/markdown", buffer: Buffer.from(alpha) },
    { name: "beta.md", mimeType: "text/markdown", buffer: Buffer.from(beta) },
    { name: "third.md", mimeType: "text/markdown", buffer: Buffer.from(third) },
  ]);
  await expect(page.locator(".sheetRowContainer strong").filter({ hasText: /^Alpha$/ })).toHaveCount(1);
  await expect(page.locator(".sheetRowContainer strong").filter({ hasText: /^Beta$/ })).toHaveCount(1);
}
async function shortcut(page: Page) {
  const modifier = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control");
  await page.keyboard.press(`${modifier}+Shift+f`); await expect(queryInput(page)).toBeFocused();
}
async function originals(page: Page) {
  await expect(async () => {
    expect(await libraryFile(page, "alpha.md")).toEqual(Array.from(Buffer.from(alpha)));
    expect(await libraryFile(page, "beta.md")).toEqual(Array.from(Buffer.from(beta)));
    expect(await libraryFile(page, "third.md")).toEqual(Array.from(Buffer.from(third)));
  }).toPass({ timeout: 5_000 });
}

test("Space search uses real source and filename results, case matching and guarded editor jumps", async ({ page }) => {
  await seed(page); await page.locator(".cm-content").click(); await shortcut(page);
  await queryInput(page).fill("alpha"); await expect(modal(page).getByRole("status")).toHaveText("3 text matches · 2 matching sheets");
  await modal(page).getByRole("checkbox", { name: "Match case", exact: true }).check();
  await expect(modal(page).getByRole("status")).toHaveText("0 text matches · 1 matching sheet");
  await queryInput(page).fill("Alpha"); await expect(modal(page).getByRole("status")).toHaveText("3 text matches · 2 matching sheets");
  await modal(page).getByRole("button", { name: "Go to beta.md, line 3, column 1", exact: true }).click();
  await expect(modal(page)).toBeHidden(); await expect(page).toHaveURL(/\/sheet\/beta\.md$/);
  await expect(page.locator(".cm-content")).toBeFocused();
  await expect(page.getByRole("button", { name: "Go to line", exact: true })).toContainText("Ln 3, Col 1");
  await workspaceAction(page, "Search everywhere"); await expect(queryInput(page)).toBeFocused(); await queryInput(page).fill("third.md");
  await expect(modal(page).getByRole("status")).toHaveText("0 text matches · 1 matching sheet");
  await modal(page).getByRole("button", { name: "Open third.md", exact: true }).click();
  await expect(page).toHaveURL(/\/sheet\/third\.md$/); await expect(page.locator(".cm-content")).toBeFocused(); await originals(page);
});

test("replacement preview writes nothing, applies only selected notes and remains undoable after closing", async ({ page }) => {
  await seed(page); await workspaceAction(page, "Search everywhere"); await queryInput(page).fill("Alpha");
  const replacement = "$& $1 🙂";
  await modal(page).getByRole("textbox", { name: "Replace with", exact: true }).fill(replacement);
  await modal(page).getByRole("button", { name: "Preview replacements", exact: true }).click();
  const preview = modal(page).getByRole("region", { name: "Replacement preview", exact: true });
  await expect(preview.getByRole("checkbox", { name: /alpha\.md/ })).toBeChecked(); await originals(page);
  await preview.getByRole("button", { name: "Review changes in alpha.md", exact: true }).click();
  await expect(preview.locator("pre").last()).toContainText(replacement);
  await preview.getByRole("checkbox", { name: /beta\.md/ }).uncheck();
  await modal(page).getByRole("button", { name: "Apply 2 replacements", exact: true }).click();
  await expect(preview.getByText("Applied", { exact: true })).toBeVisible();
  await expect(async () => expect(await libraryFile(page, "alpha.md")).toEqual(Array.from(Buffer.from(alpha.split("Alpha").join(replacement))))).toPass({ timeout: 5_000 });
  expect(await libraryFile(page, "beta.md")).toEqual(Array.from(Buffer.from(beta)));
  await modal(page).getByRole("button", { name: "Close Search everywhere", exact: true }).click();
  await expect(page.getByRole("button", { name: "Search everywhere", exact: true }).first()).toBeFocused();
  await workspaceAction(page, "Undo replacements"); await originals(page);
});

test("fresh preview includes new disk files and refuses a note changed after review", async ({ page }) => {
  await seed(page); await workspaceAction(page, "Search everywhere"); await queryInput(page).fill("Alpha");
  await expect(modal(page).getByRole("status")).toHaveText("3 text matches · 2 matching sheets");
  await libraryFile(page, "late.md", "Alpha appeared on disk.");
  await modal(page).getByRole("textbox", { name: "Replace with", exact: true }).fill("New");
  await modal(page).getByRole("button", { name: "Preview replacements", exact: true }).click();
  const preview = modal(page).getByRole("region", { name: "Replacement preview", exact: true });
  await expect(preview.getByRole("checkbox", { name: /late\.md/ })).toBeChecked();
  const external = "\uFEFF# External\r\n\r\nExternal words kept.\r\n"; await libraryFile(page, "alpha.md", Array.from(Buffer.from(external)));
  await modal(page).getByRole("button", { name: "Apply 4 replacements", exact: true }).click();
  await expect(modal(page).getByRole("alert")).toContainText("changed after preview");
  expect(await libraryFile(page, "alpha.md")).toEqual(Array.from(Buffer.from(external)));
  expect(await libraryFile(page, "beta.md")).toEqual(Array.from(Buffer.from(beta)));
  expect(await libraryFile(page, "late.md")).toEqual(Array.from(Buffer.from("Alpha appeared on disk.")));
});

test("search and its first worker load work offline and keep script-like matches as text", async ({ page, context }) => {
  await seed(page); await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true); await context.setOffline(true);
  await workspaceAction(page, "Search everywhere"); await queryInput(page).fill("বাংলা");
  await expect(modal(page).getByRole("status")).toHaveText("1 text match · 1 matching sheet");
  await queryInput(page).fill("script"); await expect(modal(page).getByRole("status")).toHaveText("2 text matches · 1 matching sheet");
  await expect(modal(page).getByRole("region", { name: "Search results", exact: true })).toContainText("<script>");
  await expect(modal(page).locator("script")).toHaveCount(0); await page.keyboard.press("Escape"); await originals(page);
});

test("a reader tab can search and review but cannot apply replacements", async ({ page, context }) => {
  test.setTimeout(60_000);
  await seed(page); const reader = await context.newPage(); await reader.goto("./");
  await expect(reader.getByText("Slate is open in another tab", { exact: false })).toBeVisible();
  await workspaceAction(reader, "Search everywhere"); await queryInput(reader).fill("Alpha");
  await expect(modal(reader).getByRole("status")).toHaveText("3 text matches · 2 matching sheets");
  await modal(reader).getByRole("textbox", { name: "Replace with", exact: true }).fill("New");
  await modal(reader).getByRole("button", { name: "Preview replacements", exact: true }).click();
  await expect(modal(reader).getByRole("button", { name: "Apply 3 replacements", exact: true })).toBeDisabled();
  await expect(modal(reader).getByText("This Space is read-only. Search and preview are available.")).toBeVisible();
  await originals(page); await reader.close();
});

for (const theme of ["light", "dark"] as const) test(`Space search ${theme} appearance has accessible fields, literal results and touch targets`, async ({ page, isMobile }, testInfo) => {
  await seed(page); await chooseAppearance(page, theme); await workspaceAction(page, "Search everywhere"); await queryInput(page).fill("Alpha");
  await expect(modal(page).getByRole("status")).toHaveText("3 text matches · 2 matching sheets");
  expect((await new AxeBuilder({ page }).include(".workspaceSearchDialog").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  if (isMobile) for (const button of await modal(page).getByRole("button").all()) {
    const bounds = await button.boundingBox(); expect(bounds?.width).toBeGreaterThanOrEqual(44); expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
  if (isMobile) {
    const target = await modal(page).locator(".searchCase").boundingBox();
    expect(target!.width).toBeGreaterThanOrEqual(44); expect(target!.height).toBeGreaterThanOrEqual(44);
  }
  const bounds = await modal(page).boundingBox(); expect(bounds!.width).toBeLessThanOrEqual(762);
  await page.screenshot({ path: testInfo.outputPath(`search-${theme}.png`) });
  await page.keyboard.press("Escape"); await expect(modal(page)).toBeHidden(); await originals(page);
});
