import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { chooseAppearance, openLibrary } from "./helpers";
import { libraryFileMatches } from "./libraryFiles";

const original = "\uFEFF# Rich documents\r\n\r\nInline $x_i$ stays with the paragraph.\r\n\r\n$$\r\n\\frac{a_1}{b^2}\r\n$$\r\n\r\n```mermaid\r\nflowchart LR\r\n A[Writing] --> B[Files]\r\n```\r\n\r\nActive.\r\n";
async function imported(page: Page, source = original) {
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "Rich.md", mimeType: "text/markdown", buffer: Buffer.from(source) });
  await expect(page.locator(".cm-content")).toBeVisible();
}
async function saved(page: Page, source = original) {
  await expect(async () => expect(await libraryFileMatches(page, "Rich.md", source)).toBe(true)).toPass({ timeout: 5_000 });
}
async function loaded(page: Page) {
  await expect(page.frameLocator('iframe[title="Math preview"]').first().locator("math")).toBeVisible();
  await expect(page.frameLocator('iframe[title="Math preview"]').nth(1).locator("mfrac")).toBeVisible();
  const diagram = page.frameLocator('iframe[title="Diagram preview"]');
  await expect(diagram.locator("svg")).toBeVisible(); await expect(diagram.getByText("Writing", { exact: true })).toBeVisible(); await expect(diagram.getByText("Files", { exact: true })).toBeVisible();
}
async function mode(page: Page, name: "Live" | "Source" | "Read") {
  const header = page.locator(".headerViewMode"), menu = page.locator(".sheetActionsMenu");
  if (await header.isVisible()) await header.getByRole("radio", { name, exact: true }).click();
  else {
    if (!await menu.evaluate(element => element.hasAttribute("open"))) await menu.locator("summary").click();
    await page.locator(".menuViewMode").getByRole("radio", { name, exact: true }).click(); await menu.locator("summary").click();
  }
}

test("lazy math and diagrams fit both themes, preserve physical source and one Undo, and reopen offline", async ({ page, context }, testInfo) => {
  await page.addInitScript(() => {
    const workers: string[] = []; Reflect.set(window, "richPreviewWorkers", workers);
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker { constructor(url: string | URL, options?: WorkerOptions) { super(url, options); workers.push(String(url)); } };
  });
  await openLibrary(page); await expect(page.locator('iframe[title="Diagram renderer"]')).toHaveCount(0);
  expect(await page.evaluate(() => (Reflect.get(window, "richPreviewWorkers") as string[]).filter(url => /math\.worker/.test(url)))).toEqual([]);
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "Rich.md", mimeType: "text/markdown", buffer: Buffer.from(original) });
  await loaded(page); await saved(page);
  expect(await page.evaluate(() => (Reflect.get(window, "richPreviewWorkers") as string[]).filter(url => /math\.worker/.test(url)).length)).toBe(1);
  await expect(page.locator('iframe[title="Math preview"]').first()).toHaveAttribute("sandbox", "allow-same-origin");
  await expect(page.locator('iframe[title="Diagram preview"]')).toHaveAttribute("sandbox", "");
  for (const theme of ["light", "dark"] as const) {
    await chooseAppearance(page, theme); await loaded(page);
    for (const control of await page.locator(".cm-slate-rich-source").all()) {
      const box = await control.evaluate(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, coarse: matchMedia("(pointer: coarse)").matches }));
      expect(box.width).toBeGreaterThanOrEqual(box.coarse ? 44 : 24); expect(box.height).toBeGreaterThanOrEqual(box.coarse ? 44 : 24);
    }
    expect(await page.locator(".editorHost").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const path = testInfo.outputPath(`rich-${theme}.png`); await page.locator(".editorHost").screenshot({ path }); await testInfo.attach(`rich-${theme}`, { path, contentType: "image/png" });
  }
  // Passive frames intentionally forbid injected scripts; scan parent controls/titles and assert native content above.
  expect((await new AxeBuilder({ page }).include(".editorHost").setLegacyMode().options({ iframes: false }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  const editor = page.locator(".cm-content"); await page.getByRole("button", { name: "Show math source", exact: true }).first().focus();
  await page.keyboard.press("Enter"); await expect(editor).toBeFocused(); await page.keyboard.insertText("z+"); await saved(page, original.replace("$x_i$", "$z+x_i$"));
  await editor.press("ControlOrMeta+z"); await saved(page); await editor.press("ControlOrMeta+End"); await loaded(page);
  await mode(page, "Source"); await expect(page.locator(".cm-slate-rich-preview")).toHaveCount(0); await saved(page);
  await mode(page, "Read"); await loaded(page); await editor.focus(); await page.keyboard.insertText("Blocked"); await saved(page);
  await mode(page, "Live"); await loaded(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true); await page.reload(); await loaded(page); await saved(page);
});

test("untrusted TeX and diagram directives cannot execute scripts or send asset requests", async ({ page }) => {
  const raw = '# Rich\n\n$\\href{javascript:alert(1)}{click}$\n\n$\\includegraphics{https://rich-preview.invalid/math.png}$\n\n```mermaid\n%%{init: {"securityLevel":"loose", "htmlLabels":true, "flowchart":{"htmlLabels":true}}}%%\nflowchart LR\n A["<img src=\'https://rich-preview.invalid/label.png\' onerror=\'parent.parent.previewExecuted=true\'>"] --> B[Done]\n```\n\n```mermaid\nflowchart LR\n A@{ img: "https://rich-preview.invalid/shape.png", label: "Asset" }\n```\n\nActive.';
  const attempts: string[] = [], requests: string[] = [], blocked: { url: string; reason: string | undefined }[] = [];
  page.on("request", request => { if (request.url().includes("rich-preview.invalid")) attempts.push(request.url()); });
  page.on("requestfailed", request => { if (request.url().includes("rich-preview.invalid")) blocked.push({ url: request.url(), reason: request.failure()?.errorText }); });
  await page.route("https://rich-preview.invalid/**", async route => { requests.push(route.request().url()); await route.fulfill({ status: 204 }); });
  await imported(page, raw);
  await expect(page.getByRole("button", { name: "Show math source", exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Show diagram source", exact: true })).toHaveCount(2);
  await expect(page.locator(".cm-slate-rich-preview[aria-busy=true]")).toHaveCount(0);
  expect(requests).toEqual([]); expect(await page.evaluate(() => Reflect.get(window, "previewExecuted"))).toBeUndefined();
  expect(attempts.every(url => blocked.some(failure => failure.url === url && /csp|content.security.policy/i.test(failure.reason ?? "")))).toBe(true);
  console.log("RICH-CSP-PROOF " + JSON.stringify({ attempts, blocked, requests }));
  await expect(page.locator(".editorHost script, .editorHost object, .cm-slate-rich-preview img")).toHaveCount(0);
  expect(await page.locator(".editorHost img").evaluateAll(images => images.every(image => image.classList.contains("cm-widgetBuffer") && image.getAttribute("aria-hidden") === "true"))).toBe(true);
  for (const frame of page.frames().filter(frame => frame.parentFrame())) expect(await frame.evaluate(() => Reflect.get(window, "previewExecuted"))).toBeUndefined();
  for (const frame of await page.locator('iframe[title="Math preview"]').all()) await expect(frame).toHaveAttribute("sandbox", "allow-same-origin");
  for (const frame of await page.locator('iframe[title="Diagram preview"]').all()) await expect(frame).toHaveAttribute("sandbox", "");
  await saved(page, raw);
});

test("table and callout math keep their semantic containers and reveal the whole active source", async ({ page }) => {
  const raw = "# Rich\n\n|$a$| Other |\n|---|---|\n|$b$| Text |\n\n> [!NOTE] Formula\n> $$\n> x^2\n>\n> +y^2\n> $$\n\nActive.";
  await imported(page, raw);
  const grid = page.getByRole("table", { name: "Markdown table", exact: true });
  await expect(grid.locator(".cm-slate-rich-preview iframe")).toHaveCount(2);
  await expect(page.getByRole("note").locator(".cm-slate-rich-preview iframe")).toHaveCount(1);
  const source = grid.getByRole("button", { name: "Show math source", exact: true }).first(); await source.focus(); await source.press("Enter");
  await expect(grid).toHaveCount(0); await expect(page.locator(".cm-content")).toContainText("|$a$| Other |"); await saved(page, raw);
  const editor = page.locator(".cm-content"); await editor.press("ControlOrMeta+End"); await expect(grid).toBeVisible();
  const quote = page.getByRole("note").getByRole("button", { name: "Show math source", exact: true }); await quote.click();
  await expect(page.getByRole("note")).toHaveCount(0); await expect(editor).toContainText("> x^2"); await saved(page, raw);
});

test("parse and size limits retain accessible source controls without changing the note", async ({ page }) => {
  const raw = "# Rich\n\n$\\frac{$\n\n$" + "x".repeat(20_001) + "$\n\n```mermaid\nnot a valid diagram\n```\n\nActive.";
  await imported(page, raw);
  await expect(page.locator(".cm-slate-rich-status").filter({ hasText: "Math preview unavailable" })).toHaveCount(2);
  await expect(page.locator(".cm-slate-rich-status").filter({ hasText: "Diagram preview unavailable" })).toHaveCount(1);
  await saved(page, raw); const editor = page.locator(".cm-content");
  await page.getByRole("button", { name: "Show diagram source", exact: true }).click(); await expect(editor).toBeFocused(); await saved(page, raw);
});
