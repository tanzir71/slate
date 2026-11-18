import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  chooseAppearance,
  createSheet,
  expectSavedSheet,
  openLibrary,
  replaceEditorText,
  workspaceAction,
} from "./helpers";
import { libraryFile, libraryPaths } from "./libraryFiles";
const settings = (page: Page) =>
  page.getByRole("dialog", { name: "Custom blocks", exact: true });
const menu = (page: Page) =>
  page.getByRole("dialog", { name: "Insert block", exact: true });
const source = "  > বাংলা 🙂\n\n${1:literal} {{title}}\n";
const path = ".slate/blocks/Callout.md";
async function manage(page: Page) {
  await workspaceAction(page, "Manage custom blocks");
  await expect(
    settings(page).getByRole("button", {
      name: "Add custom block",
      exact: true,
    }),
  ).toBeEnabled();
  return settings(page);
}
async function close(page: Page) {
  await settings(page)
    .getByRole("button", { name: "Close Custom blocks", exact: true })
    .click();
}
async function query(page: Page, value: string) {
  await page.keyboard.press("Escape");
  await replaceEditorText(page, value);
  await page.locator(".cm-content").press("ControlOrMeta+End");
}
async function seed(page: Page, content = source) {
  await libraryFile(page, path, content);
  await manage(page);
  await close(page);
}

test("forms save literal fragments; slash preview, Escape, one undo and offline reopen preserve source", async ({
  page,
  context,
  isMobile,
}) => {
  await page.addInitScript(() => {
    const Channel = window.BroadcastChannel;
    window.BroadcastChannel = class extends Channel {
      constructor(name: string) {
        if (name === "slate-blocks") throw new Error("Messaging unavailable");
        super(name);
      }
    };
  });
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  const dialog = await manage(page);
  await dialog
    .getByRole("button", { name: "Add custom block", exact: true })
    .click();
  await dialog.getByLabel("Block name", { exact: true }).fill("Callout");
  await dialog
    .getByRole("textbox", { name: "Block Markdown", exact: true })
    .fill(source);
  await dialog.getByRole("button", { name: "Save block", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Edit Callout.md", exact: true }),
  ).toBeVisible();
  expect(
    new TextDecoder().decode(new Uint8Array((await libraryFile(page, path))!)),
  ).toBe(source);
  expect(
    (
      await new AxeBuilder({ page })
        .include(".customBlockSettings")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  if (isMobile)
    for (const box of await dialog
      .locator("button:visible")
      .evaluateAll((buttons) =>
        buttons.map((button) => ({
          width: button.getBoundingClientRect().width,
          height: button.getBoundingClientRect().height,
        })),
      )) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  await page.screenshot({
    path: test.info().outputPath("custom-block-settings.png"),
  });
  await close(page);
  await query(page, "/call");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Callout");
  await editor.press("Tab");
  await expect(
    menu(page).locator(".blockMarkdownPreview code"),
  ).toHaveJSProperty("textContent", source);
  await page.keyboard.press("Escape");
  await expectSavedSheet(page, "/call");
  await query(page, "/call");
  await editor.press("Enter");
  await expectSavedSheet(page, source);
  await editor.press("ControlOrMeta+z");
  await expectSavedSheet(page, "/call");
  const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
  await editor.press(mac ? "Meta+Shift+z" : "Control+y");
  await expectSavedSheet(page, source);
  await context.setOffline(true);
  await page.reload();
  await expect(editor).toBeVisible();
  await expectSavedSheet(page, source);
  await query(page, "/call");
  await editor.press("Enter");
  await expectSavedSheet(page, source);
  await context.setOffline(false);
});

test("nested names and BOM remain files; changed fragments require reviewing the refreshed preview", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  const nested = ".slate/blocks/TeamReview.MD",
    original = "\uFEFF> First\r\n";
  await libraryFile(page, nested, original);
  await manage(page);
  await close(page);
  await query(page, "/TeamReview");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Review");
  await libraryFile(page, nested, "\uFEFF> External\r\n");
  await editor.press("Enter");
  await expect(page.locator(".blockMenuError")).toContainText("changed");
  await expectSavedSheet(page, "/TeamReview");
  await page
    .locator(".blockMenuError")
    .getByRole("button", { name: "Dismiss", exact: true })
    .click();
  await query(page, "/TeamReview");
  await editor.press("Enter");
  await expectSavedSheet(page, "> External\n");
  expect(await libraryFile(page, nested)).toEqual(
    Array.from(new TextEncoder().encode("\uFEFF> External\r\n")),
  );
});

test("editing a fragment keeps external bytes and writes a separate conflict copy", async ({
  page,
}) => {
  await openLibrary(page);
  await createSheet(page, "My note");
  await seed(page);
  const dialog = await manage(page);
  await dialog
    .getByRole("button", { name: "Edit Callout.md", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "Block Markdown", exact: true })
    .fill("> My proposal");
  const bytes = Array.from(new TextEncoder().encode("\uFEFF> External\r\n"));
  await libraryFile(page, path, bytes);
  await dialog.getByRole("button", { name: "Save block", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("preserved");
  expect(await libraryFile(page, path)).toEqual(bytes);
  const conflict = (await libraryPaths(page, true)).find(
    (entry) => entry.startsWith(".slate/blocks/Callout") && entry !== path,
  )!;
  expect(conflict).toBeTruthy();
  expect(
    new TextDecoder().decode(
      new Uint8Array((await libraryFile(page, conflict))!),
    ),
  ).toBe("> My proposal");
  await expect(
    dialog.getByRole("button", { name: "Save block", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Review current file", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Block Markdown", exact: true }),
  ).toHaveValue("\uFEFF> External\n");
  await close(page);
  await expectSavedSheet(page, "My note");
});

test("invalid UTF-8 remains downloadable and absent from slash results; settings navigation returns focus", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  await libraryFile(page, ".slate/blocks/Binary.md", [255, 254, 253]);
  const dialog = await manage(page);
  await dialog
    .getByRole("button", { name: "Edit Binary.md", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Save block", exact: true }),
  ).toBeDisabled();
  const downloading = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download original file", exact: true })
    .click();
  expect((await downloading).suggestedFilename()).toBe("Binary.md");
  await close(page);
  await query(page, "/Binary");
  await expect(menu(page).getByRole("option")).toHaveCount(0);
  await editor.press("Tab");
  const management = menu(page).getByRole("button", {
    name: "Manage custom blocks",
    exact: true,
  });
  await management.focus();
  await management.press("Enter");
  await expect(dialog).toBeVisible();
  await close(page);
  await expect(editor).toBeFocused();
  expect(await libraryFile(page, ".slate/blocks/Binary.md")).toEqual([
    255, 254, 253,
  ]);
});

test("a read-only tab keeps the custom-block draft through write ownership takeover", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  const dialog = await manage(page);
  await dialog
    .getByRole("button", { name: "Add custom block", exact: true })
    .click();
  await dialog.getByLabel("Block name", { exact: true }).fill("Ownership");
  await dialog
    .getByRole("textbox", { name: "Block Markdown", exact: true })
    .fill("> Kept draft");
  const reader = await context.newPage();
  await reader.goto(page.url());
  await reader.getByRole("button", { name: "Use here", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Save block", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("textbox", { name: "Block Markdown", exact: true }),
  ).toHaveValue("> Kept draft");
  await dialog.getByRole("button", { name: "Use here", exact: true }).click();
  await dialog.getByRole("button", { name: "Save block", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Edit Ownership.md", exact: true }),
  ).toBeVisible();
  await close(page);
  await query(page, "/Ownership");
  await editor.press("Enter");
  await expectSavedSheet(page, "> Kept draft");
  await reader.close();
});

test("Folder fragments are read and managed through the selected directory", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Folder editing requires the File System Access picker.",
  );
  await page.addInitScript(() =>
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        const folder = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle("custom-block-folder", { create: true });
        const blocks = await (
          await folder.getDirectoryHandle(".slate", { create: true })
        ).getDirectoryHandle("blocks", { create: true });
        const fragment = await (
          await blocks.getFileHandle("Folder.md", { create: true })
        ).createWritable();
        await fragment.write("> Folder fragment");
        await fragment.close();
        const note = await (
          await folder.getFileHandle("Note.md", { create: true })
        ).createWritable();
        await note.write("/Folder");
        await note.close();
        return folder;
      },
    }),
  );
  await page.goto("./");
  await page.getByText("Open a folder", { exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  const dialog = await manage(page);
  await dialog
    .getByRole("button", { name: "Edit Folder.md", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "Block Markdown", exact: true })
    .fill("> Changed folder");
  await dialog.getByRole("button", { name: "Save block", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Edit Folder.md", exact: true }),
  ).toBeVisible();
  await close(page);
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await expect(async () => {
    expect(
      await page.evaluate(async () => {
        const folder = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle("custom-block-folder");
        return (await (await folder.getFileHandle("Note.md")).getFile()).text();
      }),
    ).toBe("> Changed folder");
  }).toPass({ timeout: 5000 });
  await editor.press("ControlOrMeta+z");
  await expect(editor).toHaveText("/Folder");
});

test("an asynchronous fragment read cannot replace a changed sheet", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  await seed(page);
  await query(page, "/call");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Callout");
  await page.evaluate(() => {
    const original = FileSystemFileHandle.prototype.getFile;
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = {
      started: false,
      release: () => {
        FileSystemFileHandle.prototype.getFile = original;
        release();
      },
    };
    Object.assign(window, { slateBlockReadGate: state });
    FileSystemFileHandle.prototype.getFile = async function () {
      if (this.name === "Callout.md") {
        state.started = true;
        await gate;
      }
      return original.call(this);
    };
  });
  await editor.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { slateBlockReadGate: { started: boolean } })
            .slateBlockReadGate.started,
      ),
    )
    .toBe(true);
  await page.keyboard.insertText(" changed");
  await page.evaluate(() =>
    (
      window as Window & { slateBlockReadGate: { release(): void } }
    ).slateBlockReadGate.release(),
  );
  await expect(page.locator(".blockMenuError")).toContainText("sheet changed");
  await expectSavedSheet(page, "/call changed");
  expect(
    new TextDecoder().decode(new Uint8Array((await libraryFile(page, path))!)),
  ).toBe(source);
});

test("Editor settings opens block management and returns focus to its original control in both themes", async ({
  page,
}) => {
  await openLibrary(page);
  await createSheet(page, "A note");
  await seed(page);
  for (const theme of ["light", "dark"] as const) {
    await chooseAppearance(page, theme);
    const invoker = await workspaceAction(page, "Editor settings");
    await page
      .getByRole("dialog", { name: "Editor settings", exact: true })
      .getByRole("button", { name: "Manage custom blocks", exact: true })
      .click();
    await expect(
      settings(page).getByRole("button", {
        name: "Edit Callout.md",
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("custom-block-settings-" + theme + ".png"),
    });
    await close(page);
    await expect(invoker).toBeFocused();
  }
  await expectSavedSheet(page, "A note");
});
