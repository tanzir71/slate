import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import {
  createSheet,
  openLibrary,
  readCurrentSheet,
  workspaceAction,
} from "./helpers";

async function saved(page: import("@playwright/test").Page, source: string) {
  // A concurrent OPFS commit can briefly make a snapshot unavailable. Keep
  // requiring exact saved bytes within the existing five-second assertion gate.
  await expect(async () => {
    expect(await readCurrentSheet(page)).toBe(source);
  }).toPass({ timeout: 5_000 });
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText(
    "Saved",
  );
}
async function palette(page: import("@playwright/test").Page, name: string) {
  await page.locator(".cm-content").press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", {
    name: "Command palette",
    exact: true,
  });
  await dialog.getByRole("textbox", { name: "Search commands" }).fill("table");
  await dialog.getByRole("button", { name, exact: true }).click();
}

test("tables create separators, navigate cells and append rows with one undo and exact saved bytes", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openLibrary(page);
  const editor = await createSheet(page, "| a | b |");
  await editor.press("Enter");
  await expect(
    page.getByRole("button", { name: "Go to line", exact: true }),
  ).toHaveText("Ln 3, Col 3");
  await saved(page, "| a   | b   |\n| --- | --- |\n|     |     |");
  await page.keyboard.insertText("x\\|y");
  await editor.press("Tab");
  await expect(
    page.getByRole("button", { name: "Go to line", exact: true }),
  ).toHaveText("Ln 3, Col 10");
  await page.keyboard.insertText("বাংলা");
  const before = "| a    | b   |\n| ---- | --- |\n| x\\|y | বাংলা    |";
  await saved(page, before);
  await editor.press("Tab");
  const after =
    "| a    | b     |\n| ---- | ----- |\n| x\\|y | বাংলা |\n|      |       |";
  await saved(page, after);
  await editor.press("ControlOrMeta+z");
  await saved(page, before);
  await editor.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Go to line", exact: true }),
  ).toHaveText("Ln 3, Col 3");
  // Navigation may align padding, so assert the canonical persisted source on reopen.
  await saved(page, after.slice(0, after.lastIndexOf("\n")));
  const reopened = await readCurrentSheet(page);
  await page.reload();
  await expect(editor).toBeVisible();
  await saved(page, reopened);
});

test("palette columns align, insert and delete with undo, and protect the sole column", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openLibrary(page);
  const source = "| A | B |\n|-|-|\n| x | y |";
  const editor = await createSheet(page, source);
  await editor.press("ControlOrMeta+End");
  await palette(page, "Align table column center");
  await saved(page, "| A   | B     |\n| --- | :---: |\n| x   | y     |");
  await editor.press("ControlOrMeta+z");
  await saved(page, source);
  await palette(page, "Insert table column before");
  await saved(
    page,
    "| A   |     | B   |\n| --- | --- | --- |\n| x   |     | y   |",
  );
  await editor.press("ControlOrMeta+z");
  await saved(page, source);
  await palette(page, "Delete table column");
  const single = "| A   |\n| --- |\n| x   |";
  await saved(page, single);
  await editor.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", {
    name: "Command palette",
    exact: true,
  });
  await dialog.getByRole("textbox", { name: "Search commands" }).fill("table");
  await expect(
    dialog.getByRole("button", { name: "Delete table column", exact: true }),
  ).toHaveCount(0);
  expect(
    (await new AxeBuilder({ page }).include(".commandDialog").analyze())
      .violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await editor.press("ControlOrMeta+z");
  await saved(page, source);
});

test("leaving the editor aligns only edited tables and undo retains the typed words", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openLibrary(page);
  const untouched = "| Untouched | B |\n|-|-|\n| M | N |";
  const source = "| a | b |\n|-|-|\n| x | y |\n\n" + untouched;
  const editor = await createSheet(page, source);
  await page.reload();
  await expect(editor).toBeVisible();
  await editor.press("ControlOrMeta+Home");
  await editor.press("ArrowDown");
  await editor.press("ArrowDown");
  await editor.press("Home");
  for (let index = 0; index < 3; index++) await editor.press("ArrowRight");
  await page.keyboard.insertText(" longer");
  await page.getByRole("button", { name: "Go to line", exact: true }).focus();
  await saved(
    page,
    "| a        | b   |\n| -------- | --- |\n| x longer | y   |\n\n" +
      untouched,
  );
  await editor.press("ControlOrMeta+z");
  await saved(page, source.replace("| x |", "| x longer |"));
});

test("table save assertions survive one unavailable OPFS snapshot and still require the exact file", async ({
  page,
}) => {
  await openLibrary(page);
  const source = "| a | b |\n|-|-|\n| x | y |";
  const editor = await createSheet(page, source);
  await editor.press("ControlOrMeta+Home");
  await editor.press("ArrowDown");
  await editor.press("ArrowDown");
  await editor.press("Home");
  for (let index = 0; index < 3; index++) await editor.press("ArrowRight");
  await page.keyboard.insertText(" longer");
  await page.getByRole("button", { name: "Go to line", exact: true }).focus();
  await page.evaluate(() => {
    const get = navigator.storage.getDirectory.bind(navigator.storage);
    let missing = true;
    navigator.storage.getDirectory = async () => {
      if (missing) {
        missing = false;
        throw new DOMException(
          "Snapshot is not yet available",
          "NotFoundError",
        );
      }
      return get();
    };
  });
  const expected = "| a        | b   |\n| -------- | --- |\n| x longer | y   |";
  await saved(page, expected);
  await page.reload();
  await expect(editor).toBeVisible();
  await saved(page, expected);
});

test("smart tables can be disabled independently and the preference survives reopening", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openLibrary(page);
  const editor = await createSheet(page, "| a | b |");
  await workspaceAction(page, "Editor settings");
  const dialog = page.getByRole("dialog", {
    name: "Editor settings",
    exact: true,
  });
  await dialog
    .getByRole("checkbox", {
      name: "Edit tables with the keyboard",
      exact: true,
    })
    .uncheck();
  await expect(
    dialog.getByRole("checkbox", { name: "Indent list items", exact: true }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await expect(
    page.getByRole("button", { name: "Go to line", exact: true }),
  ).toHaveText("Ln 2, Col 1");
  await saved(page, "| a | b |\n");
  await page.reload();
  await expect(editor).toBeVisible();
  await workspaceAction(page, "Editor settings");
  await expect(
    dialog.getByRole("checkbox", {
      name: "Edit tables with the keyboard",
      exact: true,
    }),
  ).not.toBeChecked();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await expect(
    page.getByRole("button", { name: "Go to line", exact: true }),
  ).toHaveText("Ln 3, Col 1");
  await saved(page, "| a | b |\n\n");
});

test("completion wins table keys and date dialogs preserve their source snapshot", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles({
    name: "Target.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Target\n\nWords."),
  });
  await expect(
    page.getByText("Imported your files. Existing files were kept."),
  ).toBeVisible();
  const original = "| Name | Link |\n|---|---|\n| Work |  |";
  const editor = await createSheet(page, original);
  await editor.press("ControlOrMeta+End");
  await editor.press("ArrowLeft");
  await editor.press("ArrowLeft");
  await editor.pressSequentially("[[Targ");
  await expect(
    page
      .locator(".cm-slate-completions")
      .getByRole("option")
      .filter({ hasText: "Target.md" }),
  ).toBeVisible();
  await editor.press("Tab");
  await saved(page, original.replace("|  |", "| [[Target.md]] |"));
  await editor.press("ControlOrMeta+z");
  await saved(page, original.replace("|  |", "| [[Targ |"));
  await editor.press("Escape");
  await editor.press("ControlOrMeta+A");
  const dateSource = "| Date |\n|-|\n| @date |";
  await page.keyboard.insertText(dateSource.replace("@date", ""));
  await editor.press("ControlOrMeta+End");
  await editor.press("ArrowLeft");
  await editor.press("ArrowLeft");
  await editor.pressSequentially("@date");
  await expect(
    page
      .locator(".cm-slate-completions")
      .getByRole("option")
      .filter({ hasText: "Choose date…" }),
  ).toBeVisible();
  await editor.press("Enter");
  const picker = page.getByRole("dialog", { name: "Insert date", exact: true });
  await picker.getByLabel("Date", { exact: true }).fill("2026-11-18");
  await picker
    .getByRole("button", { name: "Insert date", exact: true })
    .click();
  await expect(editor).toBeFocused();
  await saved(page, dateSource.replace("@date", "2026-11-18"));
  await editor.press("ControlOrMeta+z");
  await saved(page, dateSource);
});
