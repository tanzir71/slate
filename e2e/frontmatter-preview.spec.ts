import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { chooseAppearance, openLibrary } from "./helpers";
import { libraryFile } from "./libraryFiles";
import { frontmatterFileSource } from "./frontmatterPreviewFixture";

async function saved(page: Page, source: string) {
  await expect(async () => { expect(await libraryFile(page, "Properties.md")).toEqual(Array.from(Buffer.from(source))); }).toPass({ timeout: 5_000 });
}
async function imported(page: Page, source = frontmatterFileSource) {
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "Properties.md", mimeType: "text/markdown", buffer: Buffer.from(source) });
  await expect(page.getByRole("group", { name: "Properties", exact: true })).toBeVisible();
}

test("properties use their original themed icons and retain BOM, CRLF, comments, source edits and one Undo", async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-11-17T12:02:00Z"));
  await imported(page);
  const row = page.getByRole("group", { name: "Properties", exact: true }), editor = page.locator(".cm-content");
  await expect(row.locator(".cm-slate-property-value")).toHaveText(["Draft", "#strategy  #planning", "1,500 words", "2 min ago"]);
  for (const theme of ["light", "dark"] as const) {
    await chooseAppearance(page, theme);
    const image = row.locator(`.cm-slate-property-plus-${theme}`);
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth === 16)).toBe(true);
    const geometry = await row.evaluate(element => {
      const chip = element.querySelector(".cm-slate-property")!, key = chip.querySelector(".cm-slate-property-key")!, value = chip.querySelector(".cm-slate-property-value")!;
      const keyStyle = getComputedStyle(key), valueStyle = getComputedStyle(value), chipStyle = getComputedStyle(chip);
      const icon = Array.from(element.querySelectorAll<HTMLImageElement>(".cm-slate-property-plus img")).find(image => getComputedStyle(image).display !== "none")!;
      return { coarse: matchMedia("(pointer: coarse)").matches, chipHeight: chip.getBoundingClientRect().height,
        edge: chipStyle.borderLeftWidth, radius: chipStyle.borderTopLeftRadius, padding: chipStyle.paddingInlineStart,
        key: { font: keyStyle.fontFamily, size: keyStyle.fontSize, lineHeight: keyStyle.lineHeight, weight: keyStyle.fontWeight, rendering: keyStyle.textRendering.toLowerCase() },
        value: { font: valueStyle.fontFamily, size: valueStyle.fontSize, lineHeight: valueStyle.lineHeight, weight: valueStyle.fontWeight, color: valueStyle.color },
        icon: { width: icon.getBoundingClientRect().width, height: icon.getBoundingClientRect().height, naturalWidth: icon.naturalWidth, naturalHeight: icon.naturalHeight } };
    });
    expect(geometry).toMatchObject({ edge: "1px", radius: "6px", padding: "8px", key: { size: "11px", lineHeight: "16px", weight: "400" }, value: { size: "12px", lineHeight: "16px", weight: "500", color: theme === "light" ? "rgb(154, 91, 0)" : "rgb(240, 164, 58)" }, icon: { width: 16, height: 16, naturalWidth: 16, naturalHeight: 16 } });
    expect(geometry.key.font).toContain("Geist Mono"); expect(geometry.value.font).toContain("Geist");
    expect(geometry.key.rendering).toBe("geometricprecision");
    expect(geometry.chipHeight).toBe(geometry.coarse ? 44 : 24);
    await saved(page, frontmatterFileSource);
    const path = testInfo.outputPath(`properties-${theme}.png`);
    await row.screenshot({ path, animations: "disabled" });
    await testInfo.attach(`properties-${theme}`, { path, contentType: "image/png" });
    expect((await new AxeBuilder({ page }).include(".browserEditor").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  }
  await row.getByRole("button", { name: "Show status property in source", exact: true }).click();
  await expect(row).toHaveCount(0); await expect(editor).toBeFocused();
  await saved(page, frontmatterFileSource);
  for (let step = 0; step < 5; step++) await editor.press("Shift+ArrowRight");
  await page.keyboard.insertText("Ready");
  await saved(page, frontmatterFileSource.replace("status: Draft", "status: Ready"));
  await editor.press("ControlOrMeta+End");
  await expect(row.locator('.cm-slate-property[data-key="status"] .cm-slate-property-value')).toHaveCSS("color", "rgb(168, 166, 160)");
  await editor.press("ControlOrMeta+z");
  await saved(page, frontmatterFileSource);
  await editor.press("ControlOrMeta+End");
  await expect(row.locator(".cm-slate-property-value").first()).toHaveText("Draft");
});

test("adding a unique property keeps neighboring fields and adjacent typing as separate exact-byte Undo steps", async ({ page }) => {
  const source = frontmatterFileSource.replace("\r\n---\r\n", "\r\nproperty: kept # Preserve\r\nproperty2: older\r\n---\r\n");
  await imported(page, source);
  const editor = page.locator(".cm-content");
  await editor.focus(); await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText("!");
  const typed = source + "!";
  await saved(page, typed);
  await page.getByRole("button", { name: "Add property", exact: true }).click();
  await expect(page.locator(".cm-slate-properties")).toHaveCount(0); await expect(editor).toBeFocused();
  const added = typed.replace("\r\n---\r\n", "\r\nproperty3: \r\n---\r\n");
  await saved(page, added);
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe("property3");
  await editor.press("ControlOrMeta+z"); await saved(page, typed);
  await editor.press("ControlOrMeta+z"); await saved(page, source);
  await editor.press("ControlOrMeta+End");
  await expect(page.locator(".cm-slate-property-key")).toHaveText(["status", "tags", "goal", "updated", "property", "property2"]);
});

test("relative property timestamps refresh in place without changing source or losing keyboard focus", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-17T12:02:00Z") });
  await imported(page);
  const chip = page.getByRole("button", { name: "Show updated property in source", exact: true });
  await chip.focus(); await expect(chip).toBeFocused();
  await expect(chip.locator(".cm-slate-property-value")).toHaveText("2 min ago");
  await page.clock.fastForward(60_001);
  await expect(chip.locator(".cm-slate-property-value")).toHaveText("3 min ago");
  await expect(chip).toBeFocused(); await saved(page, frontmatterFileSource);
  await chip.press("Enter");
  await expect(page.locator(".cm-slate-properties")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toBeFocused();
  await saved(page, frontmatterFileSource);
});
