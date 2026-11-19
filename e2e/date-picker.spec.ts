import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import {
  createSheet,
  openLibrary,
  expectSavedSheet as saved,
  readCurrentSheet,
  workspaceAction,
} from "./helpers";


test("date picker cancels literally, inserts a calendar date atomically and restores focus", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openLibrary(page);
  const source = "# Source\n\n";
  const editor = await createSheet(page, source);
  await editor.pressSequentially("@date");
  const option = page
    .locator(".cm-slate-completions")
    .getByRole("option")
    .filter({ hasText: "Choose date…" });
  await expect(option).toBeVisible();
  await editor.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Insert date", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Date", { exact: true })).toBeFocused();
  const controls = await dialog
    .locator("button, input")
    .evaluateAll((elements) => ({
      touch: matchMedia("(pointer: coarse)").matches,
      heights: elements.map(
        (element) => element.getBoundingClientRect().height,
      ),
    }));
  expect(
    controls.heights.every((height) => height >= (controls.touch ? 44 : 36)),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toBeFocused();
  await saved(page, source + "@date");
  await editor.pressSequentially("2");
  await expect(option).toBeVisible();
  await editor.press("Enter");
  await dialog.getByLabel("Date", { exact: true }).fill("2024-02-29");
  expect(
    (
      await new AxeBuilder({ page })
        .include('dialog[aria-label="Insert date"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  await dialog
    .getByRole("button", { name: "Insert date", exact: true })
    .click();
  await expect(editor).toBeFocused();
  await saved(page, source + "2024-02-29");
  await editor.press("ControlOrMeta+z");
  await saved(page, source + "@date2");
  await editor.press("Escape");
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText(source);
  await editor.pressSequentially("@2026-11-18");
  await expect(option).toBeVisible();
  await editor.press("Enter");
  await expect(dialog.getByLabel("Date", { exact: true })).toHaveValue(
    "2026-11-18",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await saved(page, source + "@2026-11-18");
});

test("date picker can be disabled independently and the preference survives reopening", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "# Source\n\n");
  await workspaceAction(page, "Editor settings");
  const dialog = page.getByRole("dialog", {
    name: "Editor settings",
    exact: true,
  });
  await dialog
    .getByRole("checkbox", { name: "Choose dates after @", exact: true })
    .uncheck();
  await expect(
    dialog.getByRole("checkbox", {
      name: "Suggest sheets after [[",
      exact: true,
    }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await editor.press("ControlOrMeta+End");
  await editor.pressSequentially("@date");
  await saved(page, "# Source\n\n@date");
  await expect(page.locator(".cm-slate-completions")).toHaveCount(0);
  await page.reload();
  await expect(editor).toBeVisible();
  await workspaceAction(page, "Editor settings");
  await expect(
    dialog.getByRole("checkbox", { name: "Choose dates after @", exact: true }),
  ).not.toBeChecked();
});

test("an open date picker cannot overwrite a newer external revision", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "# Source\n\n");
  await editor.pressSequentially("@date");
  await saved(page, "# Source\n\n@date");
  await expect(
    page.locator(".cm-slate-completions").getByRole("option"),
  ).toBeVisible();
  await editor.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Insert date", exact: true });
  await expect(dialog).toBeVisible();
  const external = "# External revision\n\nKeep these newer words.";
  await page.evaluate(async (content) => {
    const parts = location.hash.split("/");
    const path = decodeURIComponent(parts[4]!).split("/");
    const name = path.pop()!;
    const root = await navigator.storage.getDirectory();
    let directory = await (
      await root.getDirectoryHandle("spaces")
    ).getDirectoryHandle(decodeURIComponent(parts[2]!));
    for (const part of path)
      directory = await directory.getDirectoryHandle(part);
    const writer = await (await directory.getFileHandle(name)).createWritable();
    await writer.write(content);
    await writer.close();
    window.dispatchEvent(new Event("focus"));
  }, external);
  await expect(editor).toContainText("Keep these newer words.");
  await dialog.getByLabel("Date", { exact: true }).fill("2026-11-18");
  await dialog
    .getByRole("button", { name: "Insert date", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "This date could not be inserted.",
  );
  await saved(page, external);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await expect(editor).toContainText("Keep these newer words.");
  expect(await readCurrentSheet(page)).toBe(external);
});
