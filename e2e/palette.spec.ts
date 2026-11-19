import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { chooseAppearance, createSheet, openLibrary, readCurrentSheet, workspaceAction } from "./helpers";
import { libraryFile } from "./libraryFiles";
import type { Page } from "@playwright/test";

const first = "\uFEFF# Same\r\n\r\nAlpha words.\r\n\r\n## First goal\r\n";
const second = "\uFEFF# Same\r\n\r\nBeta words.\r\n\r\n## বাংলা লক্ষ্য\r\n";
const dialog = (page: Page, quick = false) => page.getByRole("dialog", { name: quick ? "Quick open" : "Command palette", exact: true });
async function open(page: Page, quick = false) {
  await page.keyboard.press(quick ? "ControlOrMeta+p" : "ControlOrMeta+k");
  const modal = dialog(page, quick); await expect(modal).toBeVisible();
  await expect(modal.locator("input")).toBeFocused(); return modal;
}
async function seed(page: Page) {
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles([
    { name: "alpha.md", mimeType: "text/markdown", buffer: Buffer.from(first) },
    { name: "beta.md", mimeType: "text/markdown", buffer: Buffer.from(second) },
  ]);
  await expect(page.locator(".cm-content")).toBeVisible();
  // The summary worker fills the index before opening this functional fixture.
  await expect(page.locator(".sheetRowContainer").filter({ hasText: "Same" })).toHaveCount(2);
}

test("Quick open distinguishes duplicate titles, moves to exact same-file headings and keeps original bytes offline", async ({ page, context }) => {
  await seed(page); await context.setOffline(true);
  let modal = await open(page, true); await modal.locator("input").fill("Same");
  await expect(modal.getByRole("button", { name: "Same", exact: true })).toHaveCount(2);
  const chosen = modal.getByRole("button", { name: "Same", exact: true }).filter({ hasText: "beta.md" });
  await expect(chosen).toHaveAccessibleDescription("beta.md"); await chosen.click();
  await expect(page).toHaveURL(/\/sheet\/beta\.md$/); await expect(page.locator(".cm-content")).toBeFocused();
  modal = await open(page); await modal.locator("input").fill("@ বাংলা লক্ষ্য");
  await expect(modal.getByRole("textbox", { name: "Search headings", exact: true })).toBeFocused();
  await modal.getByRole("button", { name: "বাংলা লক্ষ্য", exact: true }).click();
  await expect(page.locator(".cm-content")).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest(".cm-line")?.textContent)).toBe("## বাংলা লক্ষ্য");
  expect(await libraryFile(page, "alpha.md")).toEqual(Array.from(Buffer.from(first)));
  expect(await libraryFile(page, "beta.md")).toEqual(Array.from(Buffer.from(second)));
});

test("palette blocks retain selected words and CRLF bytes, and Undo restores the exact original", async ({ page }) => {
  await seed(page); const quick = await open(page, true); await quick.locator("input").fill("alpha.md");
  await quick.getByRole("button", { name: "Same", exact: true }).click();
  const editor = page.locator(".cm-content"); await editor.press("ControlOrMeta+Home");
  await editor.press("ControlOrMeta+Shift+End");
  await workspaceAction(page, "Command palette"); const modal = dialog(page);
  await modal.locator("input").fill("/ heading 2");
  await modal.getByRole("button", { name: "Heading 2", exact: true }).click();
  await expect(editor).toContainText("Alpha words.");
  await expect.poll(() => libraryFile(page, "alpha.md")).toEqual(Array.from(Buffer.from(first + "\r\n## ")));
  await editor.press("ControlOrMeta+z");
  await expect.poll(() => libraryFile(page, "alpha.md")).toEqual(Array.from(Buffer.from(first)));
});

test("palette snippets resolve current scoped definitions and use the real prompt flow", async ({ page }) => {
  await openLibrary(page); const editor = await createSheet(page, "Words kept.");
  await libraryFile(page, ".slate/snippets.json", JSON.stringify({ version: 1, snippets: [{ trigger: ";greet", name: "Greeting", body: "Hello {{prompt:Name}}!{{cursor}}" }] }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await workspaceAction(page, "Manage snippets");
  const settings = page.getByRole("dialog", { name: "Snippets", exact: true });
  await expect(settings).toContainText(";greet"); await settings.getByRole("button", { name: "Close Snippets", exact: true }).click();
  await editor.press("ControlOrMeta+End");
  const modal = await open(page); await modal.locator("input").fill("; greet");
  await modal.getByRole("button", { name: "Greeting", exact: true }).click();
  const prompt = page.getByRole("dialog", { name: "Insert Greeting", exact: true }); await expect(prompt).toBeVisible();
  await prompt.getByRole("textbox", { name: "Name", exact: true }).fill("বাংলা");
  await prompt.getByRole("button", { name: "Insert snippet", exact: true }).click();
  await expect(editor).toHaveText("Words kept.Hello বাংলা!"); await expect(editor).toBeFocused();
  await editor.press("ControlOrMeta+z"); await expect(editor).toHaveText("Words kept.");
});

test("a cached heading cannot move the cursor or replace externally changed source", async ({ page }) => {
  await seed(page); const modal = await open(page); await modal.locator("input").fill("@ First goal");
  await expect(modal.getByRole("button", { name: "First goal", exact: true })).toBeVisible();
  const changed = "\uFEFF# Changed outside Slate\r\n\r\nExternal words kept.\r\n";
  await libraryFile(page, "alpha.md", Array.from(Buffer.from(changed)));
  await modal.getByRole("button", { name: "First goal", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("This sheet changed");
  await expect(modal.locator("input")).toHaveValue("@ First goal");
  await expect(modal.locator("input")).toBeFocused();
  expect(await libraryFile(page, "alpha.md")).toEqual(Array.from(Buffer.from(changed)));
  await page.keyboard.press("Escape"); await expect(modal).toBeHidden();
});

test("tag mode filters the real sheet list without changing either note", async ({ page }) => {
  await openLibrary(page);
  await createSheet(page, "# Tagged\n\nWords kept. #draft/inbox\n"); const tagged = decodeURIComponent(new URL(page.url()).hash.split("/")[4]!);
  await createSheet(page, "# Other\n\nDifferent words kept.\n"); const other = decodeURIComponent(new URL(page.url()).hash.split("/")[4]!);
  const originalTagged = await libraryFile(page, tagged), originalOther = await libraryFile(page, other);
  // Wait for metadata before this functional mode check; latency has its own cold fixture.
  await expect(page.locator(".browserSidebar")).toContainText("draft/inbox");
  const modal = await open(page); await modal.locator("input").fill("# draft/inbox");
  await modal.getByRole("button", { name: "#draft/inbox", exact: true }).click();
  await expect(page.locator(".listHeading > strong")).toHaveText("#draft/inbox");
  await expect(page.locator(".browserSheetRow")).toHaveCount(1); await expect(page.locator(".browserSheetRow")).toContainText("Tagged");
  expect(await libraryFile(page, tagged)).toEqual(originalTagged); expect(await libraryFile(page, other)).toEqual(originalOther);
});

test("palette resources and templates use their real creation flows with one-step Undo", async ({ page }) => {
  await openLibrary(page); const editor = await createSheet(page, "Words kept."); await editor.press("ControlOrMeta+End");
  let modal = await open(page); await modal.locator("input").fill("/ code block");
  await modal.getByRole("button", { name: "Code block", exact: true }).click();
  const language = page.getByRole("dialog", { name: "Code language", exact: true });
  await expect(language.getByRole("combobox", { name: "Code language", exact: true })).toBeFocused();
  await language.getByRole("combobox", { name: "Code language", exact: true }).fill("python");
  await language.getByRole("button", { name: "Insert code block", exact: true }).click();
  await expect.poll(() => readCurrentSheet(page)).toContain("```python\n"); await expect(editor).toBeFocused();
  await editor.press("ControlOrMeta+z"); await expect(editor).toHaveText("Words kept.");
  await editor.press("ControlOrMeta+End"); modal = await open(page); await modal.locator("input").fill("/ meeting notes");
  await modal.getByRole("button", { name: "Meeting notes", exact: true }).click();
  const template = page.getByRole("dialog", { name: "Insert Meeting notes", exact: true });
  await template.getByRole("textbox", { name: "Template title", exact: true }).fill("Palette meeting");
  await template.getByRole("button", { name: "Insert template", exact: true }).click();
  await expect(editor).toContainText("Agenda"); await expect(editor).toContainText("Words kept.");
  await expect(editor).toContainText("Action items"); await expect(editor).toBeFocused();
  await editor.press("ControlOrMeta+z"); await expect(editor).toHaveText("Words kept.");
});

test("palette assets, geometry, theme, touch targets, preview and accessibility hold in the actual modal", async ({ page, isMobile }) => {
  await openLibrary(page); const editor = await createSheet(page, "# Literal\n\n<script>alert('keep as text')</script> words.");
  await editor.press("ControlOrMeta+End");
  for (const theme of ["light", "dark"] as const) {
    await chooseAppearance(page, theme); await workspaceAction(page, "Command palette"); const modal = dialog(page);
    await expect(modal.locator("input")).toBeFocused();
    const geometry = await modal.evaluate((element) => {
      const bounds = element.getBoundingClientRect(), input = element.querySelector(".paletteHeader")!.getBoundingClientRect();
      return { width: bounds.width, top: bounds.top, header: input.height, glyphs: Array.from(element.querySelectorAll(".paletteGlyph")).map((glyph) => ({ width: glyph.getBoundingClientRect().width, height: glyph.getBoundingClientRect().height, mask: getComputedStyle(glyph).maskImage })) };
    });
    expect(geometry.width).toBeLessThanOrEqual(640); expect(geometry.width).toBeGreaterThan(300);
    expect(geometry.top).toBeGreaterThan(0); expect(geometry.header).toBe(52);
    for (const glyph of geometry.glyphs) { expect(glyph.width).toBe(16); expect(glyph.height).toBe(16); expect(glyph.mask).not.toBe("none"); }
    if (isMobile) for (const button of await modal.getByRole("button").all()) {
      const bounds = await button.boundingBox(); expect(bounds?.width).toBeGreaterThanOrEqual(44); expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    const a11y = await new AxeBuilder({ page }).include(".slatePalette").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(a11y.violations).toEqual([]);
    await modal.locator("input").fill("Literal"); await page.keyboard.press("Tab");
    await expect(modal.getByRole("region", { name: "Result preview", exact: true })).toContainText("<script>");
    await expect(modal.locator("script")).toHaveCount(0);
    await page.keyboard.press("Escape"); await expect(modal).toBeHidden();
    await expect(page.getByRole("button", { name: "Sheet actions", exact: true })).toBeFocused();
  }
});
