import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { nativeFixture } from "./nativeFixture";
import { captureFixture } from "./captureFixture";

test.use({ viewport: { width: 560, height: 360 } });
const folder = { id: "12345678-1234-4321-9876-123456789abc", name: "Other notes", path: "C:\\Other notes" };
async function main(page: Page) {
  await nativeFixture(page, { "note.md": "Keep these words.", "Inbox/Capture.md": "\ufeffPrior\r\n" });
  await page.addInitScript(space => {
    localStorage.setItem("native-spaces", JSON.stringify([{ id: "native-default", name: "Slate", path: null }, space]));
    localStorage.setItem("native-picked-space", JSON.stringify(space));
    localStorage.setItem("native-file:folder:" + space.id + ":other.md", JSON.stringify(Array.from(new TextEncoder().encode("Other Space words."))));
  }, folder);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("./"); await expect(page.locator(".cm-content")).toBeVisible();
  await openAction(page);
}
async function openAction(page: Page) {
  await page.getByRole("button", { name: "Sheet actions", exact: true }).click();
  await page.getByRole("button", { name: "Quick Capture", exact: true }).click();
}
async function capture(context: BrowserContext) {
  const page = await context.newPage(); await captureFixture(page);
  await page.goto("./capture.html");
  await expect(page.getByRole("textbox", { name: "Slate / Inbox", exact: true })).toBeEditable(); return page;
}
const source = (page: Page, scope = "space") => page.evaluate(scope => {
  const bytes = JSON.parse(localStorage.getItem("native-file:" + scope + ":Inbox/Capture.md") ?? "null") as number[] | null;
  return bytes === null ? null : new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(bytes));
}, scope);
const destroyed = (page: Page) => page.evaluate(() => localStorage.getItem("native-destroyed"));

test("compact capture uses the actual built entry, supports both themes and appends exact prior bytes", async ({ page, context }) => {
  await main(page); const inputPage = await capture(context), input = inputPage.getByRole("textbox", { name: "Slate / Inbox", exact: true });
  await inputPage.setViewportSize({ width: 560, height: 360 });
  await expect(input).toBeFocused(); await input.fill("A thought\nবাংলা");
  expect((await new AxeBuilder({ page: inputPage }).analyze()).violations).toEqual([]);
  await inputPage.screenshot({ path: "test-results/native-capture-light.png" });
  await inputPage.evaluate(() => { localStorage.setItem("slate.appearance", "dark"); window.dispatchEvent(new StorageEvent("storage", { key: "slate.appearance" })); });
  await expect(inputPage.locator("html")).toHaveAttribute("data-theme", "dark");
  await inputPage.screenshot({ path: "test-results/native-capture-dark.png" });
  expect(await inputPage.evaluate(() => performance.getEntriesByType("resource").some(entry => /BrowserWorkspace|MarkdownEditor/.test(entry.name)))).toBe(false);
  await inputPage.keyboard.press("Control+Enter"); await expect.poll(() => destroyed(inputPage)).toBe("true");
  expect(await source(inputPage)).toBe("\ufeffPrior\r\n\r\nA thought\r\nবাংলা\r\n");
});

test("read-only capture freezes its exact draft and Retry saves once", async ({ page, context }) => {
  await main(page); const inputPage = await capture(context), input = inputPage.getByRole("textbox");
  await input.fill("Kept capture"); await inputPage.evaluate(() => localStorage.setItem("native-fail-save", "true"));
  await inputPage.getByRole("button", { name: "Save to Inbox", exact: true }).click();
  await expect(inputPage.getByRole("alert")).toHaveText("Disk is read-only"); await expect(input).toHaveAttribute("readonly", "");
  expect(await source(inputPage)).toBe("\ufeffPrior\r\n"); expect(await destroyed(inputPage)).toBeNull();
  await inputPage.evaluate(() => localStorage.removeItem("native-fail-save"));
  await inputPage.getByRole("button", { name: "Retry saving", exact: true }).click();
  await expect.poll(() => destroyed(inputPage)).toBe("true");
  expect(await source(inputPage)).toBe("\ufeffPrior\r\n\r\nKept capture\r\n");
});

test("Escape keeps a durable draft and a renderer reload restores it without appending", async ({ page, context }) => {
  await main(page); const inputPage = await capture(context);
  await inputPage.getByRole("textbox").fill("Keep for later"); await inputPage.keyboard.press("Escape");
  await expect.poll(() => destroyed(inputPage)).toBe("true");
  expect(await source(inputPage)).toBe("\ufeffPrior\r\n");
  await inputPage.evaluate(() => localStorage.removeItem("native-destroyed")); await inputPage.reload();
  await expect(inputPage.getByRole("textbox")).toHaveValue("Keep for later");
  await expect(inputPage.getByRole("textbox")).toBeEditable();
});

test("an open capture retains its original Space across a main-window switch and another manual open", async ({ page, context }) => {
  await main(page); const inputPage = await capture(context); await inputPage.getByRole("textbox").fill("Original Space only");
  await page.locator(".spaceSwitcher").click();
  await page.getByRole("dialog", { name: "Spaces", exact: true }).getByRole("button", { name: "Open a folder", exact: true }).click();
  await expect(page.locator(".cm-content")).toHaveText("Other Space words."); await openAction(page);
  await expect(inputPage.getByRole("textbox", { name: "Slate / Inbox", exact: true })).toHaveValue("Original Space only");
  await inputPage.getByRole("button", { name: "Save to Inbox", exact: true }).click(); await expect.poll(() => destroyed(inputPage)).toBe("true");
  expect(await source(inputPage)).toBe("\ufeffPrior\r\n\r\nOriginal Space only\r\n");
  expect(await source(inputPage, "folder:" + folder.id)).toBeNull();
});

test("lost save reply and renderer reload retry the same capture without duplicate text", async ({ page, context }) => {
  await main(page); const inputPage = await capture(context); await inputPage.getByRole("textbox").fill("Only once");
  await inputPage.evaluate(() => localStorage.setItem("native-capture-lose-reply", "true"));
  await inputPage.getByRole("button", { name: "Save to Inbox", exact: true }).click(); await expect(inputPage.getByRole("alert")).toHaveText("Save reply unavailable");
  expect(await source(inputPage)).toBe("\ufeffPrior\r\n\r\nOnly once\r\n"); await inputPage.reload();
  await expect(inputPage.getByRole("textbox")).toHaveValue("Only once"); await expect(inputPage.getByRole("textbox")).toHaveAttribute("readonly", "");
  await inputPage.getByRole("button", { name: "Retry saving", exact: true }).click(); await expect.poll(() => destroyed(inputPage)).toBe("true");
  expect(await source(inputPage)).toBe("\ufeffPrior\r\n\r\nOnly once\r\n");
});

async function closeDuringSave(page: Page, context: BrowserContext, checkChrome?: (input: Page) => Promise<void>) {
  await main(page); const inputPage = await capture(context); await checkChrome?.(inputPage); await inputPage.getByRole("textbox").fill("In flight");
  await inputPage.evaluate(() => localStorage.setItem("native-capture-hold-save", "true"));
  await inputPage.getByRole("button", { name: "Save to Inbox", exact: true }).click(); await expect(inputPage.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
  // Native macOS traffic lights live outside the webview. All OS close requests
  // reach this same handler; Windows/Linux button dispatch has titlebar coverage.
  await inputPage.evaluate(() => (Reflect.get(window, "__TAURI_INTERNALS__") as { invoke(command: string, args: Record<string, unknown>): Promise<unknown> }).invoke("plugin:window|close", { label: "capture" }));
  expect(await destroyed(inputPage)).toBeNull(); expect(await source(inputPage)).toBe("\ufeffPrior\r\n");
  await inputPage.evaluate(() => (Reflect.get(window, "__CAPTURE_FIXTURE__") as { releaseSave(): void }).releaseSave());
  await expect.poll(() => destroyed(inputPage)).toBe("true"); expect(await source(inputPage)).toBe("\ufeffPrior\r\n\r\nIn flight\r\n");
  expect(await inputPage.evaluate(() => localStorage.getItem("native-capture-stashes"))).toBeNull();
  return inputPage;
}

test("Close waits for an outstanding save before destroying the compact window", async ({ page, context }) => {
  await closeDuringSave(page, context);
});

test("macOS native Close waits for the same save without a Windows close button", async ({ page, context }) => {
  await context.addInitScript(() => Object.defineProperty(navigator, "platform", { configurable: true, get: () => "MacIntel" }));
  await closeDuringSave(page, context, async inputPage => {
    await expect(inputPage.locator(".workspaceHeader")).toHaveAttribute("data-native-platform", "mac");
    await expect(inputPage.getByRole("button", { name: "Close window", exact: true })).toHaveCount(0);
  });
});

test("failed Close keeps visible words until the draft can be stashed", async ({ page, context }) => {
  await main(page); const inputPage = await capture(context); await inputPage.getByRole("textbox").fill("Stay visible");
  await inputPage.evaluate(() => localStorage.setItem("native-capture-fail-stash", "true")); await inputPage.keyboard.press("Escape");
  await expect(inputPage.getByRole("alert")).toHaveText("Draft storage unavailable"); expect(await destroyed(inputPage)).toBeNull();
  await expect(inputPage.getByRole("textbox")).toHaveValue("Stay visible");
  await inputPage.evaluate(() => localStorage.removeItem("native-capture-fail-stash")); await inputPage.keyboard.press("Escape");
  await expect.poll(() => destroyed(inputPage)).toBe("true"); expect(await source(inputPage)).toBe("\ufeffPrior\r\n");
});

test("a crash after keeping newer backend words cannot restore an older local draft over them", async ({ page, context }) => {
  await main(page); const inputPage = await capture(context); await inputPage.getByRole("textbox").fill("Older local words");
  await inputPage.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("native-capture-state")!) as { activeDraft: { text: string; revision: number } };
    state.activeDraft.text = "Newer durable words"; state.activeDraft.revision = 2;
    localStorage.setItem("native-capture-state", JSON.stringify(state));
  });
  await inputPage.reload(); await expect(inputPage.getByRole("textbox")).toHaveValue("Newer durable words");
  await inputPage.getByRole("button", { name: "Save to Inbox", exact: true }).click(); await expect.poll(() => destroyed(inputPage)).toBe("true");
  expect(await source(inputPage)).toBe("\ufeffPrior\r\n\r\nNewer durable words\r\n");
});
