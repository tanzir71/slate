import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { chooseAppearance, openLibrary, showSheets, workspaceAction } from "./helpers";
import { libraryFile, libraryPaths } from "./libraryFiles";
import type { Page } from "@playwright/test";

const one = "\uFEFF  #   One\r\n\r\nWords kept\r\n";
const two = "  #   Two\n\nWords kept\n";
const formattedOne = one.replace("  #   ", "# ");
const formattedTwo = two.replace("  #   ", "# ");
const bytes = (source: string) => Array.from(Buffer.from(source));

async function seed(page: Page, legacy = false) {
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles([
    { name: "one.md", mimeType: "text/markdown", buffer: Buffer.from(one) },
    { name: "two.md", mimeType: "text/markdown", buffer: Buffer.from(two) },
    ...(legacy ? [{ name: "unsupported.md", mimeType: "text/markdown", buffer: Buffer.from([0xff, 0xfe, 65, 0]) }] : []),
  ]);
  await expect(page.locator(".cm-content")).toBeVisible();
}
async function review(page: Page, palette = false) {
  if (palette) {
    await workspaceAction(page, "Command palette");
    const commands = page.getByRole("dialog", { name: "Command palette", exact: true });
    await commands.getByRole("textbox", { name: "Search commands and sheets", exact: true }).fill("Batch Tidy");
    await commands.getByRole("button", { name: "Batch Tidy", exact: true }).click();
  } else await workspaceAction(page, "Batch Tidy");
  const dialog = page.getByRole("dialog", { name: "Batch Tidy", exact: true });
  await expect(dialog.getByRole("button", { name: "Review again", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("article", { name: "one.md", exact: true })).toBeVisible();
  return dialog;
}

test("batch review writes only chosen notes offline, keeps exact originals, and undoes after closing", async ({ page, context }) => {
  await seed(page, true);
  const before = await libraryPaths(page, true);
  const dialog = await review(page, true);
  const first = dialog.getByRole("article", { name: "one.md", exact: true });
  await expect(dialog.getByRole("article", { name: "unsupported.md", exact: true })).toContainText("Unsupported text encoding");
  await first.getByRole("button", { name: "Review diff", exact: true }).click();
  expect(await first.locator(".tidyBatchBefore").textContent()).toBe(one);
  expect(await first.locator(".tidyBatchAfter").textContent()).toBe(formattedOne);
  expect(await libraryPaths(page, true)).toEqual(before);
  expect(await libraryFile(page, "one.md")).toEqual(bytes(one));
  await dialog.getByRole("checkbox", { name: "Apply fixes to two.md", exact: true }).uncheck();
  await context.setOffline(true);
  await dialog.getByRole("button", { name: "Apply to 1 sheet", exact: true }).click();
  await expect(first).toContainText("Applied");
  expect(await libraryFile(page, "one.md")).toEqual(bytes(formattedOne));
  expect(await libraryFile(page, "two.md")).toEqual(bytes(two));
  expect(await libraryFile(page, "unsupported.md")).toEqual([0xff, 0xfe, 65, 0]);
  const originals = (await libraryPaths(page, true)).filter((path) => path.startsWith(".slate/history/"));
  expect(originals).toHaveLength(1);
  expect(originals[0]!.split("/")[2]).toMatch(/^\d{13}-[0-9a-f-]{36}$/);
  expect(await libraryFile(page, originals[0]!)).toEqual(bytes(one));
  await dialog.getByRole("button", { name: "Close Batch Tidy", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sheet actions", exact: true })).toBeFocused();
  await workspaceAction(page, "Undo batch Tidy");
  await expect.poll(() => libraryFile(page, "one.md")).toEqual(bytes(one));
  await context.setOffline(false);
  await page.reload();
  await expect(page.locator(".cm-content")).toBeVisible();
  expect(await libraryFile(page, "one.md")).toEqual(bytes(one));
  expect(await libraryFile(page, "two.md")).toEqual(bytes(two));
  expect(await libraryFile(page, originals[0]!)).toEqual(bytes(one));
});

test("batch review keeps externally changed words and requires current rules before applying", async ({ page }) => {
  await seed(page);
  const dialog = await review(page);
  await libraryFile(page, "one.md", "New external words\n");
  await dialog.getByRole("button", { name: "Apply to 2 sheets", exact: true }).click();
  await expect(dialog.getByRole("article", { name: "one.md", exact: true })).toContainText("Changed since review");
  expect(await libraryFile(page, "one.md")).toEqual(bytes("New external words\n"));
  expect(await libraryFile(page, "two.md")).toEqual(bytes(two));
  expect((await libraryPaths(page, true)).filter((path) => path.startsWith(".slate/history/"))).toEqual([]);
  await dialog.getByRole("button", { name: "Review again", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Apply to 1 sheet", exact: true })).toBeEnabled();
  await libraryFile(page, ".slate/tidy.json", '{"version":1,"preset":"minimal"}\n');
  await dialog.getByRole("button", { name: "Apply to 1 sheet", exact: true }).click();
  await expect(dialog.getByRole("alert").first()).toContainText("rules changed");
  expect(await libraryFile(page, "two.md")).toEqual(bytes(two));
});

test("batch review is keyboard accessible in both themes and retains the approved icon geometry", async ({ page, isMobile }, testInfo) => {
  await seed(page);
  for (const theme of ["light", "dark"] as const) {
    await chooseAppearance(page, theme);
    const dialog = await review(page);
    await dialog.getByRole("article", { name: "one.md", exact: true }).getByRole("button", { name: "Review diff", exact: true }).click();
    for (const selector of [".tidyIcon--apply", ".tidyIcon--diff", ".tidyIcon--close"]) {
      const box = await dialog.locator(selector).first().boundingBox();
      expect(box?.width).toBe(16); expect(box?.height).toBe(16);
    }
    if (isMobile) {
      for (const button of await dialog.getByRole("button").all()) {
        const box = await button.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    }
    const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(audit.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({ path: testInfo.outputPath(`batch-tidy-${theme}.png`) });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sheet actions", exact: true })).toBeFocused();
  }
});

test("a read-only tab can review and loses Apply immediately when another tab takes ownership", async ({ page, context }) => {
  await seed(page);
  const writerReview = await review(page);
  const reader = await context.newPage();
  await reader.goto("./");
  await expect(reader.getByRole("button", { name: "Use here", exact: true })).toBeVisible();
  const readerReview = await review(reader);
  await expect(readerReview.getByRole("button", { name: "Apply to 2 sheets", exact: true })).toBeDisabled();
  await readerReview.getByRole("button", { name: "Close Batch Tidy", exact: true }).click();
  await reader.getByRole("button", { name: "Use here", exact: true }).click();
  await expect(writerReview.getByRole("button", { name: "Apply to 2 sheets", exact: true })).toBeDisabled();
  expect(await libraryFile(page, "one.md")).toEqual(bytes(one));
  expect(await libraryFile(page, "two.md")).toEqual(bytes(two));
  await reader.close();
});

test("batch review counts remaining issues once and never applies a rejected structural change", async ({ page }) => {
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "mixed.md", mimeType: "text/markdown", buffer: Buffer.from("+ One\n- Two\n") });
  await expect(page.locator(".cm-content")).toBeVisible();
  await workspaceAction(page, "Batch Tidy");
  const dialog = page.getByRole("dialog", { name: "Batch Tidy", exact: true });
  await expect(dialog.getByText("1 item still needs review.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Apply to 1 sheet", exact: true }).click();
  await expect(dialog.getByRole("article", { name: "mixed.md", exact: true })).toContainText("Applied");
  expect(await libraryFile(page, "mixed.md")).toEqual(bytes("+ One\n\n- Two\n"));
});

test("selected Folder sheets use the real file adapter for review, history and Undo", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Folder editing requires the File System Access picker.");
  await page.addInitScript(({ one, two }) => Object.defineProperty(window, "showDirectoryPicker", {
    configurable: true,
    value: async () => {
      const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle("batch-tidy-folder", { create: true });
      for (const [path, source] of Object.entries({ "one.md": one, "two.md": two, "three.md": "  #   Three\n\nWords kept\n" })) {
        const stream = await (await folder.getFileHandle(path, { create: true })).createWritable();
        await stream.write(source); await stream.close();
      }
      return folder;
    },
  }), { one, two });
  await page.goto("./");
  await page.getByText("Open a folder", { exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await showSheets(page);
  await page.getByRole("button", { name: "Select sheets", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select all filtered sheets", exact: true }).check();
  await page.locator(".sheetRowContainer").filter({ has: page.locator('.browserSheetRow[data-path="three.md"]') }).getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Tidy selected", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Batch Tidy", exact: true });
  await expect(dialog.getByRole("button", { name: "Apply to 2 sheets", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("article")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Apply to 2 sheets", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("0 sheets with changes · 2 applied");
  async function folderNote(path: string) {
    return page.evaluate(async (path) => {
      const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle("batch-tidy-folder");
      return Array.from(new Uint8Array(await (await (await folder.getFileHandle(path)).getFile()).arrayBuffer()));
    }, path);
  }
  expect(await folderNote("one.md")).toEqual(bytes(formattedOne));
  expect(await folderNote("two.md")).toEqual(bytes(formattedTwo));
  expect(await folderNote("three.md")).toEqual(bytes("  #   Three\n\nWords kept\n"));
  await dialog.getByRole("button", { name: "Undo batch", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("0 sheets with changes · 0 applied");
  expect(await folderNote("one.md")).toEqual(bytes(one));
  expect(await folderNote("two.md")).toEqual(bytes(two));
});
