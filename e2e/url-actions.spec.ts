import { expect, test } from "./fixtures";
import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { openLibrary, readCurrentSheet } from "./helpers";
import { libraryFile, libraryPaths } from "./libraryFiles";

async function seed(page: Page) {
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "Kept.md", mimeType: "text/markdown", buffer: Buffer.from("# Kept\n\nOriginal words.") });
  await expect.poll(() => libraryFile(page, "Kept.md")).toEqual(Array.from(Buffer.from("# Kept\n\nOriginal words.")));
}

test("new links ask before writing and preserve their requested title and physical text", async ({ page }, testInfo) => {
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "Existing.md", mimeType: "text/markdown", buffer: Buffer.from("Existing words.") });
  await expect.poll(() => libraryFile(page, "Existing.md")).toEqual(Array.from(Buffer.from("Existing words.")));
  const text = "\uFEFF# Linked\r\n\r\nWords supplied by the link.\r\n";
  await page.goto("./?" + new URLSearchParams({ action: "new", title: "Linked note", notebook: "Work", text }));
  const dialog = page.getByRole("dialog", { name: "Open in Slate", exact: true });
  await expect(dialog).toBeVisible();
  expect(await libraryPaths(page)).toEqual(["Existing.md"]);
  expect((await new AxeBuilder({ page }).include('dialog[aria-label="Open in Slate"]').analyze()).violations).toEqual([]);
  await testInfo.attach("url-new-confirmation", { body: await dialog.screenshot(), contentType: "image/png" });
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => libraryFile(page, "Work/Linked note.md")).toEqual(Array.from(Buffer.from(text)));
  expect(await libraryPaths(page)).toEqual(["Existing.md", "Work/Linked note.md"]);
  expect(await libraryFile(page, "Existing.md")).toEqual(Array.from(Buffer.from("Existing words.")));
});

test("append links review before writing, retain original bytes and undo in one step", async ({ page }) => {
  await openLibrary(page);
  const before = "\uFEFF# Kept\r\n\r\nOriginal words.\r\n";
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "Kept.md", mimeType: "text/markdown", buffer: Buffer.from(before) });
  await expect.poll(() => libraryFile(page, "Kept.md")).toEqual(Array.from(Buffer.from(before)));
  await page.goto("./?" + new URLSearchParams({ action: "append", path: "Kept.md", text: "New\nwords." }));
  const dialog = page.getByRole("dialog", { name: "Open in Slate", exact: true });
  await expect(dialog).toBeVisible();
  expect(await libraryFile(page, "Kept.md")).toEqual(Array.from(Buffer.from(before)));
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => libraryFile(page, "Kept.md")).toEqual(Array.from(Buffer.from(before + "\r\nNew\r\nwords.")));
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => libraryFile(page, "Kept.md")).toEqual(Array.from(Buffer.from(before)));
});

test("open and search links read existing notes and preserve their words", async ({ page }) => {
  await seed(page);
  const before = await libraryFile(page, "Kept.md");
  await page.goto("./?" + new URLSearchParams({ action: "open", path: "Kept.md" }));
  await expect(page).toHaveURL(/\/sheet\/Kept\.md$/);
  await expect(page.locator(".cm-content")).toContainText("Original words.");
  await page.goto("./?" + new URLSearchParams({ action: "search", query: "Original" }));
  const dialog = page.getByRole("dialog", { name: "Search everywhere", exact: true });
  await expect(dialog.getByRole("textbox", { name: /^Search in / })).toHaveValue("Original");
  await expect(dialog.getByRole("button", { name: "Go to Kept.md, line 3, column 1", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await libraryFile(page, "Kept.md")).toEqual(before);
  expect(await libraryPaths(page)).toEqual(["Kept.md"]);
});

test("a template link previews its title, notebook and literal additional text before creation", async ({ page }, testInfo) => {
  await seed(page);
  const text = "Literal {{clipboard}} and {{prompt:Secret}} remain text.";
  await page.goto("./?" + new URLSearchParams({ action: "new", template: "meeting-notes", title: "Review: next", notebook: "Work", text }));
  const dialog = page.getByRole("dialog", { name: "New from template", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Review: next");
  await expect(dialog.getByRole("combobox", { name: "Notebook", exact: true })).toHaveValue("Work");
  await expect(dialog.getByRole("textbox", { name: "Additional text", exact: true })).toHaveValue(text);
  await expect(dialog.getByText("Reading Space templates…")).toHaveCount(0);
  expect(await libraryPaths(page)).toEqual(["Kept.md"]);
  expect((await new AxeBuilder({ page }).include('dialog[aria-label="New from template"]').analyze()).violations).toEqual([]);
  await testInfo.attach("url-template-preview", { body: await dialog.screenshot(), contentType: "image/png" });
  const day = await dialog.getByLabel("Date", { exact: true }).inputValue();
  await dialog.getByRole("button", { name: "Create ↵", exact: true }).click();
  await expect(dialog).toBeHidden();
  const path = `Work/${day}-review-next.md`;
  await expect(page).toHaveURL(url => decodeURIComponent(url.hash.split("/sheet/")[1] ?? "") === path);
  const source = await readCurrentSheet(page);
  expect(source).toContain('title: "Review: next"');
  expect(source.endsWith(text)).toBe(true);
  expect(source).not.toContain("template:");
  expect(await libraryPaths(page)).toEqual(["Kept.md", path]);
});

test("cancelled, unsafe and unknown-template links leave files unchanged", async ({ page }, testInfo) => {
  await seed(page);
  const before = await libraryFile(page, "Kept.md");
  const dialog = page.getByRole("dialog", { name: "Open in Slate", exact: true });
  await page.goto("./?" + new URLSearchParams({ action: "append", path: "Kept.md", text: "Unconfirmed words." }));
  await expect(dialog).toBeVisible();
  expect((await new AxeBuilder({ page }).include('dialog[aria-label="Open in Slate"]').analyze()).violations).toEqual([]);
  await testInfo.attach("url-append-confirmation", { body: await dialog.screenshot(), contentType: "image/png" });
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
  for (const params of [{ action: "append", path: "../Kept.md", text: "Unsafe" }, { action: "new", template: "missing-template" }]) {
    await page.goto("./?" + new URLSearchParams(params));
    await expect(dialog.getByRole("alert")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await libraryFile(page, "Kept.md")).toEqual(before);
    expect(await libraryPaths(page)).toEqual(["Kept.md"]);
  }
});

test("an incoming installed-app URL waits without replacing the current confirmation", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "launchQueue", { configurable: true, value: {
      setConsumer(consumer: (launch: { targetURL: string; files: [] }) => void) {
        document.addEventListener("slate-test-launch", event => consumer({ targetURL: (event as CustomEvent<string>).detail, files: [] }));
      },
    } });
  });
  await seed(page);
  await page.goto("./?" + new URLSearchParams({ action: "new", title: "First", text: "First words." }));
  const dialog = page.getByRole("dialog", { name: "Open in Slate", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("First");
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent("slate-test-launch", { detail: location.href }));
    document.dispatchEvent(new CustomEvent("slate-test-launch", { detail: new URL("?action=append&path=Kept.md&text=Second+words.", location.href).href }));
  });
  await expect(page.getByRole("status").filter({ hasText: "1 incoming request waiting." })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("First");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Review next request", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Text to append", exact: true })).toHaveValue("Second words.");
  expect(await libraryFile(page, "Kept.md")).toEqual(Array.from(Buffer.from("# Kept\n\nOriginal words.")));
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => libraryFile(page, "Kept.md")).toEqual(Array.from(Buffer.from("# Kept\n\nOriginal words.\n\nSecond words.")));
  expect(await libraryFile(page, "Inbox/First.md")).toEqual(Array.from(Buffer.from("First words.")));
});

test("a first installed-app launch matching a cancelled URL still asks and retains its text", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "launchQueue", { configurable: true, value: {
      setConsumer(consumer: (launch: { targetURL: string; files: [] }) => void) {
        document.addEventListener("slate-test-launch", event => consumer({ targetURL: (event as CustomEvent<string>).detail, files: [] }));
      },
    } });
  });
  await seed(page);
  const text = "Keep these incoming words.";
  await page.goto("./?" + new URLSearchParams({ action: "new", title: "Again", text }));
  const targetURL = page.url(), dialog = page.getByRole("dialog", { name: "Open in Slate", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.evaluate(targetURL => document.dispatchEvent(new CustomEvent("slate-test-launch", { detail: targetURL })), targetURL);
  await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Again");
  await expect(dialog.getByRole("textbox", { name: "New sheet text", exact: true })).toHaveValue(text);
  expect(await libraryPaths(page)).toEqual(["Kept.md"]);
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => libraryFile(page, "Inbox/Again.md")).toEqual(Array.from(Buffer.from(text)));
});
