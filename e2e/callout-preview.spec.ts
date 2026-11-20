import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { chooseAppearance, createSheet, openLibrary } from "./helpers";
import { libraryFile } from "./libraryFiles";

const source = "\uFEFF# Callout\r\n\r\n> [!TIP] Keep the core free\r\n> Everything that lives on your disk stays free. Sync and publishing are optional add-ons.\r\n\r\nActive.\r\n";
async function saved(page: Page, text: string) {
  await expect(async () => {
    expect(await libraryFile(page, "Callout.md")).toEqual(Array.from(Buffer.from(text)));
  }).toPass({ timeout: 5_000 });
}

test("callout cards use the original themed icons and preserve BOM, CRLF and one typing undo", async ({ page }, testInfo) => {
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "Callout.md", mimeType: "text/markdown", buffer: Buffer.from(source) });
  const editor = page.locator(".cm-content"), title = page.locator(".cm-slate-callout-title");
  await expect(title).toHaveText("Keep the core free");
  await saved(page, source);
  for (const theme of ["light", "dark"] as const) {
    await chooseAppearance(page, theme);
    await expect.poll(() => title.locator(`.cm-slate-callout-icon-${theme}`).evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth === 16)).toBe(true);
    const geometry = await title.evaluate(element => {
      const style = getComputedStyle(element);
      const image = Array.from(element.querySelectorAll<HTMLImageElement>(".cm-slate-callout-icon img")).find(icon => getComputedStyle(icon).display !== "none")!;
      const box = image.getBoundingClientRect();
      return { font: style.fontFamily, size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight,
        edge: style.borderLeftWidth, paddingLeft: style.paddingLeft, paddingTop: style.paddingTop,
        image: { className: image.className, loaded: image.complete && image.naturalWidth > 0, width: box.width, height: box.height, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight } };
    });
    expect(geometry.font).toContain("Geist");
    expect(geometry).toMatchObject({ size: "13px", weight: "500", lineHeight: "20px", edge: "3px", paddingLeft: "44px", paddingTop: "14px" });
    expect(geometry.image).toMatchObject({ className: `cm-slate-callout-icon-${theme}`, loaded: true, width: 16, height: 16, naturalWidth: 16, naturalHeight: 16 });
    const start = (await title.boundingBox())!, end = (await page.locator(".cm-slate-callout-end").boundingBox())!;
    const path = testInfo.outputPath(`callout-${theme}.png`);
    await page.screenshot({ path, clip: { x: start.x, y: start.y, width: start.width, height: end.y + end.height - start.y }, animations: "disabled" });
    await testInfo.attach(`callout-${theme}`, { path, contentType: "image/png" });
  }
  const accessibility = await new AxeBuilder({ page }).include(".browserEditor").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  await title.locator(".cm-slate-callout-icon img:visible").click();
  await expect(title).toHaveCount(0);
  await expect(editor).toContainText("> [!TIP] Keep the core free");
  await saved(page, source);
  await editor.press("End");
  await page.keyboard.insertText("!");
  await saved(page, source.replace("Keep the core free", "Keep the core free!"));
  await editor.press("ControlOrMeta+z");
  await saved(page, source);
  await editor.press("ControlOrMeta+End");
  await expect(title).toHaveText("Keep the core free");
});

test("all five callout kinds keep separate titles and leave code and unknown markers literal", async ({ page }) => {
  await openLibrary(page);
  const kinds = ["NOTE", "TIP", "WARNING", "IMPORTANT", "CAUTION"];
  const raw = "# Callouts\n\n" + kinds.map(kind => `> [!${kind}]\n> ${kind} words`).join("\n\n") + "\n\n```md\n> [!TIP]\n> Code\n```\n\n> [!UNKNOWN]\n> Literal\n\nActive.";
  const editor = await createSheet(page, raw);
  await editor.press("ControlOrMeta+Home");
  await expect(page.locator(".cm-slate-callout-title")).toHaveText(["Note", "Tip", "Warning", "Important", "Caution"]);
  await expect(page.locator(".cm-slate-callout-body")).toHaveText(kinds.map(kind => `${kind} words`));
  await expect(editor).toContainText("[!UNKNOWN]");
});
