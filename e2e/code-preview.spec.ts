import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { chooseAppearance, openLibrary } from "./helpers";
import { libraryFileMatches } from "./libraryFiles";

const source = "\uFEFF# Code\r\n\r\n```python\r\ndef greet():\r\n    return 'Hello'\r\n```\r\n\r\nActive.\r\n";
async function saved(page: Page, text = source) {
  await expect(async () => expect(await libraryFileMatches(page, "Code.md", text)).toBe(true)).toPass({ timeout: 5_000 });
}
async function imported(page: Page, text = source) {
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "Code.md", mimeType: "text/markdown", buffer: Buffer.from(text) });
  await expect(page.locator(".cm-slate-code-header").first()).toBeVisible();
}
async function chooseMode(page: Page, name: "Live" | "Source") {
  const header = page.locator(".headerViewMode"), menu = page.locator(".sheetActionsMenu");
  if (await header.isVisible()) await header.getByRole("radio", { name, exact: true }).click();
  else {
    if (!await menu.evaluate(element => element.hasAttribute("open"))) await menu.locator("summary").click();
    await page.locator(".menuViewMode").getByRole("radio", { name, exact: true }).click();
    await menu.locator("summary").click();
  }
}

test("fenced code lazily highlights, keeps themed controls accessible and preserves physical bytes and Undo", async ({ page }, testInfo) => {
  const requests: string[] = [];
  page.on("request", request => { if (/\.js(?:\?|$)/.test(request.url())) requests.push(request.url()); });
  await openLibrary(page);
  const initial = new Set(requests);
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "Code.md", mimeType: "text/markdown", buffer: Buffer.from(source) });
  const block = page.locator(".cm-slate-code-block"), editor = page.locator(".cm-content");
  await expect(block.locator(".tok-keyword").first()).toHaveText("def");
  expect(requests.some(url => !initial.has(url))).toBe(true);
  await saved(page);
  expect(await libraryFileMatches(page, "Code.md", source.replace("\uFEFF", ""))).toBe(false);
  expect(await libraryFileMatches(page, "Code.md", source.replaceAll("\r\n", "\n"))).toBe(false);
  for (const theme of ["light", "dark"] as const) {
    await chooseAppearance(page, theme);
    const geometry = await block.evaluate(element => {
      const style = getComputedStyle(element), line = getComputedStyle(element.querySelector(".cm-slate-code-line")!);
      return { background: style.backgroundColor, radius: style.borderRadius, font: line.fontFamily, size: line.fontSize,
        controls: Array.from(element.querySelectorAll("button"), button => ({ height: button.getBoundingClientRect().height, width: button.getBoundingClientRect().width })), coarse: matchMedia("(pointer: coarse)").matches };
    });
    expect(geometry).toMatchObject({ radius: "8px", size: "13px", background: theme === "light" ? "rgb(243, 242, 239)" : "rgb(36, 36, 35)" });
    expect(geometry.font).toContain("Geist Mono");
    for (const control of geometry.controls) { expect(control.height).toBeGreaterThanOrEqual(geometry.coarse ? 44 : 24); expect(control.width).toBeGreaterThanOrEqual(24); }
    expect((await new AxeBuilder({ page }).include(".browserEditor").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    const path = testInfo.outputPath(`code-${theme}.png`);
    await block.screenshot({ path, animations: "disabled" }); await testInfo.attach(`code-${theme}`, { path, contentType: "image/png" });
  }
  await block.getByRole("button", { name: "Show python code fence in source", exact: true }).click();
  await expect(editor).toBeFocused(); await expect(page.locator(".cm-slate-code-opening")).toHaveText("```python");
  await page.keyboard.insertText("3"); await saved(page, source.replace("```python", "```3python"));
  await editor.press("ControlOrMeta+z"); await saved(page);
  await editor.press("ControlOrMeta+End"); await expect(page.locator(".cm-slate-code-language")).toHaveText("python");
  await chooseMode(page, "Source");
  await expect(page.locator(".cm-slate-code-block")).toHaveCount(0); await expect(editor).toContainText("```python"); await saved(page);
  await chooseMode(page, "Live");
  await expect(block).toBeVisible(); await saved(page);
});

test("copying nested code handles success and denial without changing document bytes or selection", async ({ page }) => {
  const raw = "\uFEFF# Code\r\n\r\n> [!NOTE]\r\n> ```js\r\n> const count = 1;\r\n> \r\n>   keepIndent();\r\n> ```\r\n\r\nActive.\r\n";
  await imported(page, raw);
  await expect(page.locator(".cm-slate-callout-container")).toHaveCount(1);
  await expect(page.locator(".cm-slate-callout-container > .cm-slate-code-block")).toHaveCount(1);
  const nested = await page.locator(".cm-slate-code-line").filter({ hasText: "const count" }).evaluate(element => {
    const style = getComputedStyle(element);
    return { font: style.fontFamily, padding: style.paddingInlineStart, border: style.borderLeftWidth };
  });
  expect(nested.font).toContain("Geist Mono"); expect(nested.padding).toBe("12px"); expect(nested.border).toBe("0px");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => {
      Reflect.set(window, "copiedCode", text);
      if (Reflect.get(window, "denyCodeCopy")) throw new DOMException("Denied", "NotAllowedError");
    } } });
  });
  const selection = await page.locator(".cm-content").evaluate(() => { const selection = getSelection(); return { text: selection?.toString(), offset: selection?.anchorOffset }; });
  const copy = page.getByRole("button", { name: "Copy code", exact: true });
  await copy.click(); await expect(copy).toHaveText("Copied");
  expect(await page.evaluate(() => Reflect.get(window, "copiedCode"))).toBe("const count = 1;\n\n  keepIndent();\n");
  expect(await page.locator(".cm-content").evaluate(() => { const selection = getSelection(); return { text: selection?.toString(), offset: selection?.anchorOffset }; })).toEqual(selection);
  await saved(page, raw);
  await page.evaluate(() => Reflect.set(window, "denyCodeCopy", true));
  await copy.click(); await expect(copy).toHaveText("Copy failed"); await saved(page, raw);
});

test("unknown languages, empty fences and untrusted code stay literal without executing markup", async ({ page }) => {
  const raw = "# Code\n\n```unknown-language\n<img src='https://code.invalid/pixel' onerror='window.codeExecuted=true'>\n```\n\n~~~\n~~~\n\nActive.";
  const external: string[] = [];
  page.on("request", request => { if (request.url().includes("code.invalid")) external.push(request.url()); });
  await imported(page, raw);
  await expect(page.locator(".cm-slate-code-language")).toHaveText(["unknown-language", "Plain text"]);
  await expect(page.locator(".cm-slate-code-block").first()).toContainText("<img src=");
  expect(await page.evaluate(() => Reflect.get(window, "codeExecuted"))).toBeUndefined(); expect(external).toEqual([]);
  await saved(page, raw);
});

test.describe("when a language chunk is unavailable", () => {
  test.use({ serviceWorkers: "block" });
  test("keeps code literal and editable after a failed lazy import", async ({ page }) => {
    await openLibrary(page);
    let blocked = 0;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/assets/*.js", async route => {
      const response = await route.fetch(), body = await response.text();
      // Identify the pinned catalog by its language metadata; keep import/file UI chunks available.
      if (body.includes('name:"Python"') && body.includes('name:"Rust"')) { blocked++; await route.abort("failed"); }
      else await route.fulfill({ response });
    });
    await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "Code.md", mimeType: "text/markdown", buffer: Buffer.from(source) });
    await expect(page.locator(".cm-slate-code-language")).toHaveText("python");
    await expect.poll(() => blocked).toBeGreaterThan(0);
    const editor = page.locator(".cm-content");
    await editor.press("ControlOrMeta+End"); await page.keyboard.insertText("Still editable.");
    await saved(page, source + "Still editable.");
    await expect(page.locator(".cm-slate-code-line .tok-keyword")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test("a 50k-word code block retains virtualized lines and edits its last line with one Undo", async ({ page }) => {
  const lines = Array.from({ length: 10_000 }, (_, index) => `const item${index} = 'some value';`);
  const raw = "# Code\n\n```js\n" + lines.join("\n") + "\n```\n\nActive.";
  await imported(page, raw);
  expect(await page.locator(".cm-slate-code-block .cm-line").count()).toBeLessThan(200);
  const editor = page.locator(".cm-content");
  await editor.press("ControlOrMeta+End");
  await expect(editor.getByText("Active.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Go to line", exact: true }).click();
  const jump = page.getByRole("dialog", { name: "Go to line", exact: true });
  await jump.getByLabel("Line number", { exact: true }).fill(String(lines.length + 3));
  await jump.getByRole("button", { name: "Go", exact: true }).click();
  await expect(editor).toBeFocused();
  await expect(page.getByRole("button", { name: "Go to line", exact: true })).toHaveText(`Ln ${lines.length + 3}, Col 1`);
  await editor.press("End");
  await expect(page.getByRole("button", { name: "Go to line", exact: true })).toHaveText(`Ln ${lines.length + 3}, Col ${lines.at(-1)!.length + 1}`);
  await page.keyboard.insertText("!");
  await saved(page, raw.replace(lines.at(-1)!, lines.at(-1)! + "!"));
  await expect(page.locator(".cm-slate-code-line").filter({ hasText: lines.at(-1)! + "!" })).toBeVisible();
  expect(await page.locator(".cm-slate-code-block .cm-line").count()).toBeLessThan(200);
  await editor.press("ControlOrMeta+z"); await saved(page, raw);
});
