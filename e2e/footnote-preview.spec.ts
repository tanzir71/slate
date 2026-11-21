import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { chooseAppearance, openLibrary } from "./helpers";
import { libraryFileMatches } from "./libraryFiles";

const source = "\uFEFF# Notes\r\n\r\nA claim[^note].\r\n\r\n[^note]: A **strong** note with `code`.\r\n\r\n    A second paragraph.\r\n\r\nActive.\r\n";
async function saved(page: Page, text = source) {
  await expect(async () => expect(await libraryFileMatches(page, "Notes.md", text)).toBe(true)).toPass({ timeout: 5_000 });
}
async function imported(page: Page, text = source) {
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "Notes.md", mimeType: "text/markdown", buffer: Buffer.from(text) });
  await expect(page.getByRole("button", { name: "Footnote note", exact: true })).toBeVisible();
}

test("footnote previews work by hover, keyboard and tap, fit both themes and preserve physical bytes and Undo", async ({ page }, testInfo) => {
  await imported(page);
  const button = page.getByRole("button", { name: "Footnote note", exact: true }), editor = page.locator(".cm-content"), tooltip = page.getByRole("tooltip");
  for (const theme of ["light", "dark"] as const) {
    await chooseAppearance(page, theme);
    await button.click();
    await expect(tooltip).toBeVisible(); await expect(tooltip).toHaveText("A strong note with code.\n\nA second paragraph.");
    const geometry = await button.evaluate(element => {
      const tip = element.parentElement!.querySelector<HTMLElement>("[role=tooltip]")!, bounds = tip.getBoundingClientRect();
      return { height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width, coarse: matchMedia("(pointer: coarse)").matches,
        verticalAlign: getComputedStyle(element).verticalAlign, font: getComputedStyle(tip).fontFamily, radius: getComputedStyle(tip).borderRadius,
        left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight };
    });
    expect(geometry.verticalAlign).toBe("super"); expect(geometry.font).toContain("Geist"); expect(geometry.radius).toBe("8px");
    expect(geometry.height).toBeGreaterThanOrEqual(geometry.coarse ? 44 : 24); expect(geometry.width).toBeGreaterThanOrEqual(geometry.coarse ? 44 : 24);
    expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.top).toBeGreaterThanOrEqual(0); expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect((await new AxeBuilder({ page }).include(".browserEditor").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    const path = testInfo.outputPath(`footnote-${theme}.png`); await tooltip.screenshot({ path, animations: "disabled" });
    await testInfo.attach(`footnote-${theme}`, { path, contentType: "image/png" });
    await saved(page);
  }
  await button.focus(); await expect(tooltip).toBeVisible(); await button.press("Escape"); await expect(tooltip).toHaveCount(0);
  await page.mouse.move(0, 0); await button.hover(); await expect(tooltip).toBeVisible(); await tooltip.hover(); await expect(tooltip).toBeVisible();
  await editor.getByText("A claim", { exact: false }).click({ position: { x: 3, y: 10 } });
  await expect(button).toHaveCount(0); await expect(editor).toContainText("A claim[^note].");
  await editor.press("End"); await page.keyboard.insertText("!"); await saved(page, source.replace("A claim[^note].", "A claim[^note].!"));
  await editor.press("ControlOrMeta+z"); await saved(page);
  await editor.press("ControlOrMeta+End"); await expect(button).toBeVisible();
  await page.reload(); await expect(button).toBeVisible(); await button.click(); await expect(tooltip).toContainText("A second paragraph."); await saved(page);
});

test("missing, nested and untrusted footnotes stay local and literal, with no embedded resources or execution", async ({ page }) => {
  const raw = "# Notes\n\nA claim[^note] and[^missing].\n\n> [^note]: A **quoted** note.\n>     ![caption](https://note.invalid/image.png) [bad](javascript:alert(1)) <img src='https://note.invalid/pixel' onerror='window.noteExecuted=true'>\n\nActive.";
  const requests: string[] = []; page.on("request", request => { if (request.url().includes("note.invalid")) requests.push(request.url()); });
  await imported(page, raw);
  await page.getByRole("button", { name: "Footnote note", exact: true }).click();
  const tooltip = page.getByRole("tooltip"); await expect(tooltip).toContainText("A quoted note."); await expect(tooltip).toContainText("caption");
  await expect(tooltip.locator("img, a, iframe, script")).toHaveCount(0);
  await page.getByRole("button", { name: "Footnote missing", exact: true }).click(); await expect(tooltip).toHaveText("Footnote definition not found.");
  expect(requests).toEqual([]); expect(await page.evaluate(() => Reflect.get(window, "noteExecuted"))).toBeUndefined(); await saved(page, raw);
});

test("a 50k-word note resolves a definition beyond the viewport while retaining virtualized editable lines", async ({ page }) => {
  const paragraphs = Array.from({ length: 10_000 }, (_, index) => `Paragraph ${index} has five words.`);
  const raw = "# Notes\n\nA claim[^note].\n\n" + paragraphs.join("\n\n") + "\n\n[^note]: A distant definition.\n\nActive.";
  await imported(page, raw); await page.getByRole("button", { name: "Footnote note", exact: true }).click();
  await expect(page.getByRole("tooltip")).toHaveText("A distant definition.");
  expect(await page.locator(".cm-line").count()).toBeLessThan(200); await saved(page, raw);
  const editor = page.locator(".cm-content"); await editor.press("ControlOrMeta+End");
  await expect(editor.getByText("Active.", { exact: true })).toBeVisible(); await page.keyboard.insertText("!"); await saved(page, raw + "!");
  await editor.press("ControlOrMeta+z"); await saved(page, raw);
});
