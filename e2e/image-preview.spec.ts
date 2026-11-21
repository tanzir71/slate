import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";
import { chooseAppearance, openLibrary } from "./helpers";
import { libraryFile, libraryFileMatches } from "./libraryFiles";

const png = readFileSync("apps/web/public/brand/icon-192.png");
const source = "\uFEFF# Images\r\n\r\n![Diagram <safe>](./cover.png)\r\n\r\nActive.\r\n";
async function imported(page: Page, raw = source, assets = [{ name: "cover.png", mimeType: "image/png", buffer: png }]) {
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles([{ name: "Images.md", mimeType: "text/markdown", buffer: Buffer.from(raw) }, ...assets]);
  await expect(page.locator(".cm-content")).toBeVisible();
}
async function saved(page: Page, raw = source) {
  await expect(async () => expect(await libraryFileMatches(page, "Images.md", raw)).toBe(true)).toPass({ timeout: 5_000 });
}
async function loaded(page: Page, alt = "Diagram <safe>") {
  const button = page.getByRole("button", { name: "Show image source: " + alt, exact: true });
  await expect(button.locator("img")).toBeVisible();
  await expect.poll(() => button.locator("img").evaluate(element => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);
  return button;
}
async function chooseMode(page: Page, name: "Live" | "Source" | "Read") {
  const header = page.locator(".headerViewMode"), menu = page.locator(".sheetActionsMenu");
  if (await header.isVisible()) await header.getByRole("radio", { name, exact: true }).click();
  else {
    if (!await menu.evaluate(element => element.hasAttribute("open"))) await menu.locator("summary").click();
    await page.locator(".menuViewMode").getByRole("radio", { name, exact: true }).click();
    await menu.locator("summary").click();
  }
}

test("local image previews fit both themes and preserve physical bytes, keyboard source editing, one Undo and offline reload", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const records = { created: [] as { url: string; bytes: number[] }[], revoked: [] as string[] };
    Reflect.set(window, "slateImageRecords", records);
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = object => {
      const url = create(object);
      if (object instanceof Blob && object.type.startsWith("image/")) void object.arrayBuffer().then(bytes => records.created.push({ url, bytes: Array.from(new Uint8Array(bytes)) }));
      return url;
    };
    URL.revokeObjectURL = url => { records.revoked.push(url); revoke(url); };
  });
  await imported(page);
  const button = await loaded(page), editor = page.locator(".cm-content");
  await expect(button.locator(".cm-slate-image-caption")).toHaveText("Diagram <safe>");
  await expect(button.locator("safe")).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include(".editorHost").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  for (const theme of ["light", "dark"] as const) {
    await chooseAppearance(page, theme);
    const bounds = await button.evaluate(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, coarse: matchMedia("(pointer: coarse)").matches, viewport: innerWidth }));
    expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
    expect(bounds.width).toBeGreaterThanOrEqual(bounds.coarse ? 44 : 24); expect(bounds.height).toBeGreaterThanOrEqual(bounds.coarse ? 44 : 24);
    const path = testInfo.outputPath(`image-${theme}.png`); await button.screenshot({ path }); await testInfo.attach(`image-${theme}`, { path, contentType: "image/png" });
  }
  await expect.poll(() => page.evaluate(() => {
    const records = Reflect.get(window, "slateImageRecords") as { created: { bytes: number[] }[] };
    return records.created[0]?.bytes;
  })).toEqual(Array.from(png));
  await saved(page); expect(await libraryFile(page, "cover.png")).toEqual(Array.from(png));
  const oldURL = await button.locator("img").getAttribute("src");
  await button.focus(); await button.press("Enter"); await expect(button).toHaveCount(0);
  await expect(editor).toBeFocused(); await page.keyboard.insertText("Edited ");
  await saved(page, source.replace("Diagram", "Edited Diagram"));
  await editor.press("ControlOrMeta+z"); await saved(page);
  expect(await page.evaluate(url => (Reflect.get(window, "slateImageRecords") as { revoked: string[] }).revoked.includes(url!), oldURL)).toBe(true);
  await editor.press("ControlOrMeta+End"); await loaded(page);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.context().setOffline(true); await page.reload(); await loaded(page); await saved(page);
  expect(await libraryFile(page, "cover.png")).toEqual(Array.from(png));
});

test("Source and Read keep original image bytes and Read rejects typing", async ({ page }) => {
  await imported(page); await loaded(page);
  await chooseMode(page, "Source"); await expect(page.locator(".cm-slate-image-preview")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("![Diagram <safe>](./cover.png)"); await saved(page);
  await chooseMode(page, "Read"); await loaded(page);
  const editor = page.locator(".cm-content"); await expect(editor).toHaveAttribute("contenteditable", "false");
  await editor.focus(); await page.keyboard.insertText("Blocked"); await saved(page);
  await chooseMode(page, "Live"); await loaded(page); await saved(page);
});

test("SVG stays an image and remote, missing and unsafe destinations never execute or contact an external host", async ({ page }) => {
  const raw = "# Images\n\n![Vector](./unsafe.svg)\n\n![Remote](https://images.invalid/direct.png)\n\n![Missing](./missing.png)\n\n![Unsafe](javascript:alert(1))\n\nActive.";
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="blue"/><script>window.previewExecuted=true</script><image href="https://images.invalid/track.png"/></svg>';
  const requests: string[] = []; page.on("request", request => { if (request.url().includes("images.invalid")) requests.push(request.url()); });
  await imported(page, raw, [{ name: "unsafe.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) }]); await loaded(page, "Vector");
  for (const alt of ["Remote", "Missing", "Unsafe"]) {
    const control = page.getByRole("button", { name: "Show image source: " + alt, exact: true });
    await expect(control.locator(".cm-slate-image-status")).toHaveText("Image unavailable"); await expect(control.locator("img")).toHaveCount(0);
  }
  expect(requests).toEqual([]); expect(await page.evaluate(() => Reflect.get(window, "previewExecuted"))).toBeUndefined();
  await expect(page.locator(".editorHost svg, .editorHost script, .editorHost iframe, .editorHost object")).toHaveCount(0); await saved(page, raw);
});

test("a 50k-word reference image resolves beyond the viewport and keeps virtualized editing and scroll return intact", async ({ page }) => {
  const paragraphs = Array.from({ length: 10_000 }, (_, index) => `Paragraph ${index} has five words.`);
  const raw = "# Images\n\n![Cover][cover]\n\n" + paragraphs.join("\n\n") + "\n\n[cover]: ./cover.png\n\nActive.";
  await imported(page, raw); await loaded(page, "Cover"); await saved(page, raw);
  expect(await page.locator(".cm-line").count()).toBeLessThan(200);
  const editor = page.locator(".cm-content"); await editor.press("ControlOrMeta+End"); await expect(editor.getByText("Active.", { exact: true })).toBeVisible();
  await page.keyboard.insertText("!"); await saved(page, raw + "!"); await editor.press("ControlOrMeta+z"); await saved(page, raw);
  await editor.press("ControlOrMeta+Home"); await loaded(page, "Cover"); expect(await page.locator(".cm-line").count()).toBeLessThan(200); await saved(page, raw);
});

test("a linked image retains normal modifier-click navigation without changing its Markdown", async ({ page }) => {
  const raw = "# Images\n\n[![Linked](./cover.png)](https://link.invalid/target)\n\nActive.";
  await page.context().route("https://link.invalid/**", route => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Linked image target</title>Target" }));
  await imported(page, raw); const button = await loaded(page, "Linked");
  const popup = page.waitForEvent("popup"); await button.click({ modifiers: ["ControlOrMeta"] });
  const target = await popup; await expect(target).toHaveURL("https://link.invalid/target"); await target.close(); await saved(page, raw);
});

test("table images retain cell geometry, links, source editing, modes and offline bytes", async ({ page }, testInfo) => {
  const raw = "\uFEFF# Images\r\n\r\n|![Header](./cover.png)|Other|\r\n|---|---|\r\n|![Cover](./cover.png)|Before **bold** ![Ref][asset] after|\r\n|[![A\\|B](./cover.png)](https://link.invalid/target)![Second](./cover.png)|[site](https://example.test)|\r\n\r\n[asset]: ./cover.png\r\n\r\nActive.\r\n";
  await page.context().route("https://link.invalid/**", route => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Table image target</title>Target" }));
  await imported(page, raw);
  const grid = page.getByRole("table", { name: "Markdown table", exact: true }), editor = page.locator(".cm-content");
  for (const alt of ["Header", "Cover", "Ref", "A|B", "Second"]) await loaded(page, alt);
  await expect(grid.getByRole("row")).toHaveCount(3); await expect(grid.getByRole("columnheader")).toHaveCount(2); await expect(grid.getByRole("cell")).toHaveCount(4);
  await expect(grid.getByRole("cell").nth(1)).toContainText("Before bold"); await expect(grid.getByRole("cell").nth(1)).toContainText("after");
  await expect(grid.getByRole("cell").nth(2).locator(".cm-slate-image-preview")).toHaveCount(2);
  expect((await new AxeBuilder({ page }).include(".editorHost").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  for (const theme of ["light", "dark"] as const) {
    await chooseAppearance(page, theme);
    expect(await grid.locator(".cm-slate-image-preview img").evaluateAll(images => images.every(image => {
      const cell = image.closest('[role="cell"], [role="columnheader"]');
      return cell !== null && image.getBoundingClientRect().width <= cell.getBoundingClientRect().width;
    }))).toBe(true);
    const path = testInfo.outputPath(`table-image-${theme}.png`); await grid.screenshot({ path }); await testInfo.attach(`table-image-${theme}`, { path, contentType: "image/png" });
  }
  const linked = page.getByRole("button", { name: "Show image source: A|B", exact: true }), popup = page.waitForEvent("popup");
  await linked.click({ modifiers: ["ControlOrMeta"] }); const target = await popup; await expect(target).toHaveURL("https://link.invalid/target"); await target.close(); await saved(page, raw);
  const cover = await loaded(page, "Cover"); await cover.focus(); await cover.press("Enter");
  await expect(grid).toHaveCount(0); await expect(page.locator(".cm-slate-image-preview")).toHaveCount(0); await expect(editor).toBeFocused();
  await page.keyboard.insertText("Edited "); await saved(page, raw.replace("![Cover]", "![Edited Cover]"));
  await editor.press("ControlOrMeta+z"); await saved(page, raw); await editor.press("ControlOrMeta+End"); await loaded(page, "Cover");
  await chooseMode(page, "Source"); await expect(grid).toHaveCount(0); await expect(page.locator(".cm-slate-image-preview")).toHaveCount(0); await saved(page, raw);
  await chooseMode(page, "Read"); await loaded(page, "Cover"); await expect(grid.getByRole("cell")).toHaveCount(4);
  await editor.focus(); await page.keyboard.insertText("Blocked"); await saved(page, raw);
  await chooseMode(page, "Live"); await editor.press("ControlOrMeta+End"); await loaded(page, "Cover");
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  // The popup assertion is complete; routing disables normal HTTP caching in Playwright.
  await page.context().unroute("https://link.invalid/**");
  await page.context().setOffline(true); await page.reload(); await loaded(page, "Cover"); await saved(page, raw); expect(await libraryFile(page, "cover.png")).toEqual(Array.from(png));
});
