import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import {
  chooseAppearance,
  createSheet,
  openLibrary,
  readCurrentSheet,
  showSheets,
  workspaceAction,
} from "./helpers";

test("workspace dimensions, truthful goal rows, saved pins and density survive reopening", async ({
  page,
  isMobile,
}) => {
  await openLibrary(page);
  await createSheet(
    page,
    "---\ngoal: { type: words, target: 100 }\n---\n# My goal\n\nWords worth keeping. #work",
  );
  await workspaceAction(page, "Pin sheet");
  await showSheets(page);
  const row = page.locator(".browserSheetRow").filter({ hasText: "My goal" });
  await expect(row.getByLabel("Pinned", { exact: true })).toBeVisible();
  await expect(row.getByRole("img", { name: /of 100 words/ })).toBeVisible();
  await page
    .getByRole("combobox", { name: "Sheet density", exact: true })
    .selectOption("compact");
  await expect(page.locator(".browserSheetRows")).toHaveAttribute(
    "data-density",
    "compact",
  );
  await page.reload();
  await showSheets(page);
  await expect(
    page.getByRole("combobox", { name: "Sheet density", exact: true }),
  ).toHaveValue("compact");
  await expect(row.getByLabel("Pinned", { exact: true })).toBeVisible();
  expect(
    await page.locator(".workspaceHeader").getAttribute("data-window-controls"),
  ).toBe("false");
  await expect(
    page.getByRole("button", { name: "Close window", exact: true }),
  ).toHaveCount(0);
  if (!isMobile) {
    await page.setViewportSize({ width: 1440, height: 900 });
    expect((await page.locator(".browserSidebar").boundingBox())!.width).toBe(
      248,
    );
    expect((await page.locator(".browserSheetList").boundingBox())!.width).toBe(
      300,
    );
    expect((await page.locator(".workspaceHeader").boundingBox())!.height).toBe(
      40,
    );
    expect((await page.locator(".workspaceStatus").boundingBox())!.height).toBe(
      28,
    );
  }
  await createSheet(page, "# No goal\n\nPlain writing.");
  await showSheets(page);
  await expect(
    page
      .locator(".browserSheetRow")
      .filter({ hasText: "No goal" })
      .getByRole("img"),
  ).toHaveCount(0);
});

test("mobile switches panes, exposes all workspace actions and keeps touch controls usable", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Single-pane and coarse-pointer layout");
  await page.setViewportSize({ width: 390, height: 844 });
  await openLibrary(page);
  await createSheet(page, "# Mobile\n\nKeep my writing.");
  await expect(
    page.getByRole("complementary", { name: "Sheets", exact: true }),
  ).toBeHidden();
  await expect(page.locator(".browserSidebar")).toBeHidden();
  await showSheets(page);
  await expect(page.locator(".browserEditor")).toBeHidden();
  await page
    .getByRole("button", { name: "Show navigation", exact: true })
    .click();
  await expect(page.locator(".browserSidebar")).toBeVisible();
  await page
    .locator(".browserSidebar > .navItem")
    .filter({ hasText: /^Inbox/ })
    .click();
  await expect(page.locator(".browserSidebar")).toBeHidden();
  await page.locator(".browserSheetRow").filter({ hasText: "Mobile" }).click();
  await expect(page.locator(".cm-content")).toContainText("Keep my writing.");
  await chooseAppearance(page, "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await workspaceAction(page, "Keyboard shortcuts");
  await expect(
    page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Sheet actions", exact: true }),
  ).toBeFocused();
  for (const name of [
    "Show navigation",
    "Show sheets",
    "Search sheets",
    "New Sheet",
    "Toggle inspector",
    "Sheet actions",
  ]) {
    const box = await page
      .locator(".workspaceHeader")
      .getByRole("button", { name, exact: true })
      .boundingBox();
    expect(box!.width, name).toBeGreaterThanOrEqual(44);
    expect(box!.height, name).toBeGreaterThanOrEqual(44);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("status actions report real writing and navigate lines without editing the file", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Alpha\nBeta\nGamma");
  await page.getByRole("button", { name: "Go to line", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Go to line", exact: true });
  await dialog.getByRole("spinbutton", { name: "Line number" }).fill("2");
  await dialog.getByRole("button", { name: "Go", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Go to line", exact: true }),
  ).toHaveText("Ln 2, Col 1");
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText("AlphaBetaGamma");
  await page
    .getByRole("button", { name: "Writing statistics", exact: true })
    .click();
  const stats = page.getByRole("dialog", {
    name: "Writing statistics",
    exact: true,
  });
  await expect(stats).toContainText("Words3");
  await expect(stats).toContainText("Lines3");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Writing statistics", exact: true }),
  ).toBeFocused();
  for (const theme of ["light", "dark"] as const) {
    await chooseAppearance(page, theme);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(result.violations).toEqual([]);
  }
});

test("bulk move and trash preserve every selected file and its recoverable copy", async ({
  page,
}) => {
  await openLibrary(page);
  await createSheet(page, "# Alpha\n\nFirst exact words.");
  await createSheet(page, "# Beta\n\nSecond exact words.");
  await showSheets(page);
  await page
    .getByRole("button", { name: "Select sheets", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Select all filtered sheets", exact: true })
    .check();
  await page
    .locator(".sheetSelectionControls")
    .getByRole("button", { name: "Move", exact: true })
    .click();
  const move = page.getByRole("dialog", { name: "Move sheet", exact: true });
  await expect(move).toContainText("2 selected sheets");
  await move
    .getByRole("textbox", { name: "Notebook path", exact: true })
    .fill("Archive");
  await move.getByRole("button", { name: "Save", exact: true }).click();
  await expect(move).toBeHidden();
  await showSheets(page);
  await page
    .getByRole("checkbox", { name: "Select all filtered sheets", exact: true })
    .check();
  await page
    .locator(".sheetSelectionControls")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  const trash = page.getByRole("dialog", {
    name: "Move this sheet to trash?",
    exact: true,
  });
  await expect(trash).toContainText("2 selected sheets");
  await trash
    .getByRole("button", { name: "Move to trash", exact: true })
    .click();
  await expect(trash).toBeHidden();
  await showSheets(page);
  await expect(page.locator(".browserSheetRow")).toHaveCount(0);
  const copies = await page.evaluate(async () => {
    const id = decodeURIComponent(location.hash.split("/")[2]!);
    const root = await navigator.storage.getDirectory();
    const space = await (
      await root.getDirectoryHandle("spaces")
    ).getDirectoryHandle(id);
    async function collect(
      directory: FileSystemDirectoryHandle,
    ): Promise<string[]> {
      const result: string[] = [];
      for await (const handle of directory.values()) {
        if (handle.kind === "directory")
          result.push(...(await collect(handle)));
        else if (handle.name.endsWith(".md"))
          result.push(await (await handle.getFile()).text());
      }
      return result;
    }
    return collect(
      await (
        await space.getDirectoryHandle(".slate")
      ).getDirectoryHandle("trash"),
    );
  });
  expect(copies.sort()).toEqual([
    "# Alpha\n\nFirst exact words.",
    "# Beta\n\nSecond exact words.",
  ]);
});

test("large sheet lists render a bounded window and allow keyboard access to the last row", async ({
  page,
}) => {
  await openLibrary(page);
  await createSheet(page, "# Original\n\nKeep this file.");
  await page.evaluate(async () => {
    const id = decodeURIComponent(location.hash.split("/")[2]!);
    const root = await navigator.storage.getDirectory();
    const space = await (
      await root.getDirectoryHandle("spaces")
    ).getDirectoryHandle(id);
    for (let index = 0; index < 100; index++) {
      const writer = await (
        await space.getFileHandle(`Note${String(index).padStart(3, "0")}.md`, {
          create: true,
        })
      ).createWritable();
      await writer.write(`# Note ${index}\n\nExact writing ${index}.`);
      await writer.close();
    }
  });
  await page.reload();
  await showSheets(page);
  await expect(page.locator(".listFoot")).toHaveText("101 sheets");
  const rows = page.locator(".browserSheetRow");
  expect(await rows.count()).toBeLessThan(30);
  await rows.first().focus();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("button", { name: /Note 99 Exact writing 99/ }),
  ).toBeFocused();
  expect(await rows.count()).toBeLessThan(30);
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content")).toContainText("Exact writing 99.");
});

test("nested notebook collapse persists and Today reopens the same daily file", async ({
  page,
}) => {
  await openLibrary(page);
  if (!(await page.locator(".browserSidebar").isVisible()))
    await page
      .getByRole("button", { name: "Show navigation", exact: true })
      .click();
  const invoker = page.getByRole("button", {
    name: "New notebook",
    exact: true,
  });
  await invoker.click();
  let dialog = page.getByRole("dialog", { name: "New notebook", exact: true });
  await page.keyboard.press("Escape");
  await expect(invoker).toBeFocused();
  await invoker.click();
  dialog = page.getByRole("dialog", { name: "New notebook", exact: true });
  await dialog
    .getByRole("textbox", { name: "Notebook path", exact: true })
    .fill("Work/Projects");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".cm-content")).toBeVisible();
  if (!(await page.locator(".browserSidebar").isVisible()))
    await page
      .getByRole("button", { name: "Show navigation", exact: true })
      .click();
  await page
    .getByRole("button", { name: "Collapse Work", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Notebook Work/Projects", exact: true }),
  ).toBeHidden();
  await page.reload();
  await expect(page.locator(".workspaceHeader")).toBeVisible();
  if (!(await page.locator(".browserSidebar").isVisible()))
    await page
      .getByRole("button", { name: "Show navigation", exact: true })
      .click();
  await expect(
    page.getByRole("button", { name: "Expand Work", exact: true }),
  ).toBeVisible();
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${modifier}+Shift+d`);
  await expect(page).toHaveURL(/Daily%2F\d{4}-\d{2}-\d{2}\.md$/);
  const url = page.url();
  const editor = page.locator(".cm-content");
  await editor.focus();
  await page.keyboard.press(`${modifier}+End`);
  await page.keyboard.insertText("Keep today's exact words.");
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText(
    "Saved",
  );
  await page.keyboard.press(`${modifier}+Shift+d`);
  await expect(page).toHaveURL(url);
  await expect(editor).toContainText("Keep today's exact words.");
});

test("a bulk move stops at a collision and retries only unfinished sheets", async ({
  page,
}) => {
  await openLibrary(page);
  await createSheet(page, "# Alpha\n\nFirst exact words.");
  await createSheet(page, "# Beta\n\nSecond exact words.");
  await page.evaluate(async () => {
    const id = decodeURIComponent(location.hash.split("/")[2]!);
    const root = await navigator.storage.getDirectory();
    const space = await (
      await root.getDirectoryHandle("spaces")
    ).getDirectoryHandle(id);
    const destination = await space.getDirectoryHandle("Archive", {
      create: true,
    });
    const writer = await (
      await destination.getFileHandle("Untitled.md", { create: true })
    ).createWritable();
    await writer.write("Existing destination words.");
    await writer.close();
  });
  await showSheets(page);
  await page
    .getByRole("button", { name: "Select sheets", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Select Alpha", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Select Beta", exact: true })
    .check();
  await page
    .locator(".sheetSelectionControls")
    .getByRole("button", { name: "Move", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Move sheet", exact: true });
  await dialog
    .getByRole("textbox", { name: "Notebook path", exact: true })
    .fill("Archive");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "A file already exists at the destination.",
  );
  await dialog
    .getByRole("textbox", { name: "Notebook path", exact: true })
    .fill("Retry");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  const files = await page.evaluate(async () => {
    const id = decodeURIComponent(location.hash.split("/")[2]!);
    const root = await navigator.storage.getDirectory();
    const space = await (
      await root.getDirectoryHandle("spaces")
    ).getDirectoryHandle(id);
    const result: Record<string, string> = {};
    for (const path of [
      "Archive/Untitled.md",
      "Archive/Untitled (1).md",
      "Retry/Untitled.md",
    ]) {
      const [directory, filename] = path.split("/");
      result[path] = await (
        await (
          await space.getDirectoryHandle(directory!)
        ).getFileHandle(filename!)
      )
        .getFile()
        .then((file) => file.text());
    }
    return result;
  });
  expect(files).toEqual({
    "Archive/Untitled.md": "Existing destination words.",
    "Archive/Untitled (1).md": "# Beta\n\nSecond exact words.",
    "Retry/Untitled.md": "# Alpha\n\nFirst exact words.",
  });
});

test("the closed inspector avoids full-body scans and shows current headings when opened", async ({
  page,
}) => {
  const content =
    "# Inspector scan fixture\n\n## First section\n\nQuiet words.";
  await openLibrary(page);
  const editor = await createSheet(page, content);
  await expect(
    page.getByRole("button", { name: "Writing statistics", exact: true }),
  ).toContainText("2 words");
  await expect(
    page.getByRole("complementary", { name: "Inspector", exact: true }),
  ).toHaveCount(0);
  await page.evaluate((marker) => {
    const diagnostic = window as Window & { inspectorBodyScans: number };
    diagnostic.inspectorBodyScans = 0;
    const original = String.prototype.split;
    Object.defineProperty(String.prototype, "split", {
      configurable: true,
      writable: true,
      value(this: string, separator: unknown, limit?: number) {
        if (separator === "\n" && String(this).startsWith(marker))
          diagnostic.inspectorBodyScans++;
        return Reflect.apply(original, this, [separator, limit]) as string[];
      },
    });
  }, "# Inspector scan fixture");
  const scans = () =>
    page.evaluate(
      () =>
        (window as Window & { inspectorBodyScans: number }).inspectorBodyScans,
    );
  await chooseAppearance(page, "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await scans()).toBe(0);
  await workspaceAction(page, "Toggle inspector");
  const inspector = page.getByRole("complementary", {
    name: "Inspector",
    exact: true,
  });
  await expect(
    inspector.getByText("First section", { exact: true }),
  ).toBeVisible();
  expect(await scans()).toBeGreaterThan(0);
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\n\n### New third section");
  await expect(
    inspector.getByText("New third section", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText(
    "Saved",
  );
  expect(await readCurrentSheet(page)).toBe(
    `${content}\n\n### New third section`,
  );
  await workspaceAction(page, "Toggle inspector");
  await expect(inspector).toHaveCount(0);
  await page.evaluate(() => {
    (window as Window & { inspectorBodyScans: number }).inspectorBodyScans = 0;
  });
  await chooseAppearance(page, "light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await scans()).toBe(0);
});
