import { expect, test } from "./fixtures";
import { openLibrary, workspaceAction } from "./helpers";
import { libraryFile } from "./libraryFiles";
import type { Page } from "@playwright/test";

const alpha = "\uFEFF# Alpha\r\n\r\nOriginal words.\r\n";
const beta = "# Beta\r\n\r\nBeta words.\r\n";
async function open(page: Page, path: string) {
  const modifier = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control");
  await page.keyboard.press(`${modifier}+p`);
  const dialog = page.getByRole("dialog", { name: "Quick open", exact: true });
  await dialog.locator("input").fill(path);
  await dialog.getByRole("button").filter({ hasText: path }).click();
  await expect(page).toHaveURL(new RegExp(`/sheet/${path.replace(".", "\\.")}$`));
  await expect(dialog).toBeHidden();
  const editor = page.locator(".cm-content"); await expect(editor).toBeFocused(); return editor;
}

test("back and forward save drafts, read current disk bytes and discard the forward branch after a new visit", async ({ page }) => {
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles([
    { name: "alpha.md", mimeType: "text/markdown", buffer: Buffer.from(alpha) },
    { name: "beta.md", mimeType: "text/markdown", buffer: Buffer.from(beta) },
    { name: "gamma.md", mimeType: "text/markdown", buffer: Buffer.from("# Gamma\n") },
  ]);
  await expect(page.locator(".sheetRowContainer").filter({ hasText: "Alpha" })).toHaveCount(1);
  await expect(page.locator(".sheetRowContainer").filter({ hasText: "Beta" })).toHaveCount(1);
  await open(page, "alpha.md");
  const editor = await open(page, "beta.md");
  const modifier = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control");
  await editor.press(`${modifier}+End`); await page.keyboard.insertText("Draft kept.");
  const changedAlpha = "\uFEFF# Alpha outside\r\n\r\nExternal words kept.\r\n";
  await libraryFile(page, "alpha.md", Array.from(Buffer.from(changedAlpha)));
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page).toHaveURL(/\/sheet\/alpha\.md$/);
  await expect(editor).toBeFocused();
  await expect(editor).toContainText("External words kept.");
  await expect(async () => expect(await libraryFile(page, "beta.md")).toEqual(Array.from(Buffer.from(beta + "Draft kept.")))).toPass({ timeout: 5_000 });
  expect(await libraryFile(page, "alpha.md")).toEqual(Array.from(Buffer.from(changedAlpha)));
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page).toHaveURL(/\/sheet\/beta\.md$/); await expect(editor).toContainText("Draft kept.");
  await expect(editor).toBeFocused();
  await workspaceAction(page, "Go back"); await expect(page).toHaveURL(/\/sheet\/alpha\.md$/);
  await expect(editor).toBeFocused();
  await open(page, "gamma.md");
  await page.getByRole("button", { name: "Sheet actions", exact: true }).click();
  await expect(page.locator(".sheetActionsItems").getByRole("button", { name: "Go forward", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await workspaceAction(page, "Command palette");
  const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
  await palette.locator("input").fill("> go back");
  await palette.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page).toHaveURL(/\/sheet\/alpha\.md$/);
  await expect(editor).toBeFocused();
  expect(await libraryFile(page, "alpha.md")).toEqual(Array.from(Buffer.from(changedAlpha)));
  expect(await libraryFile(page, "gamma.md")).toEqual(Array.from(Buffer.from("# Gamma\n")));
});

test("macOS navigation takes priority over editor word movement and respects modal and composition scopes", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { configurable: true, get: () => "MacIntel" }));
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles([
    { name: "alpha.md", mimeType: "text/markdown", buffer: Buffer.from(alpha) },
    { name: "beta.md", mimeType: "text/markdown", buffer: Buffer.from(beta) },
  ]);
  await expect(page.locator(".sheetRowContainer").filter({ hasText: "Alpha" })).toHaveCount(1);
  await expect(page.locator(".sheetRowContainer").filter({ hasText: "Beta" })).toHaveCount(1);
  await open(page, "alpha.md"); const editor = await open(page, "beta.md");
  const composing = await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft", altKey: true, isComposing: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event); return event.defaultPrevented;
  });
  expect(composing).toBe(false); await expect(page).toHaveURL(/\/sheet\/beta\.md$/);
  await page.keyboard.press("Meta+p");
  const quick = page.getByRole("dialog", { name: "Quick open", exact: true }); await expect(quick).toBeVisible();
  const inModal = await quick.locator("input").evaluate((element) => {
    const event = new KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft", altKey: true, bubbles: true, cancelable: true });
    element.dispatchEvent(event); return event.defaultPrevented;
  });
  expect(inModal).toBe(false); await expect(page).toHaveURL(/\/sheet\/beta\.md$/);
  await page.keyboard.press("Escape"); await expect(editor).toBeFocused();
  await page.keyboard.press("Alt+ArrowLeft"); await expect(page).toHaveURL(/\/sheet\/alpha\.md$/);
  await editor.click(); await page.keyboard.press("Alt+ArrowRight"); await expect(page).toHaveURL(/\/sheet\/beta\.md$/);
  expect(await libraryFile(page, "alpha.md")).toEqual(Array.from(Buffer.from(alpha)));
  expect(await libraryFile(page, "beta.md")).toEqual(Array.from(Buffer.from(beta)));
});
