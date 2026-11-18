import { expect, test } from "./fixtures";
import {
  createSheet,
  openLibrary,
  readCurrentSheet,
  workspaceAction,
} from "./helpers";

async function saved(page: import("@playwright/test").Page, text: string) {
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText(
    "Saved",
  );
  expect(await readCurrentSheet(page)).toBe(text);
}

test("typed pairs retain selected words and each complete wrapper is one undo", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openLibrary(page);
  const editor = await createSheet(page, "words");
  for (const [typed, expected] of [
    ["*", "*words*"],
    ["_", "_words_"],
    ["`", "`words`"],
    ["~~", "~~words~~"],
    ["==", "==words=="],
    ["[", "[words]"],
    ["(", "(words)"],
  ]) {
    await editor.press("ControlOrMeta+A");
    await editor.pressSequentially(typed!);
    await saved(page, expected!);
    await editor.press("ControlOrMeta+z");
    await saved(page, "words");
  }
  await editor.press("ControlOrMeta+End");
  await editor.pressSequentially("[");
  await saved(page, "words[");
});

test("selection wrapping can be disabled without reopening the editor", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "words");
  await workspaceAction(page, "Editor settings");
  const dialog = page.getByRole("dialog", {
    name: "Editor settings",
    exact: true,
  });
  await dialog
    .getByRole("checkbox", { name: "Wrap selected text", exact: true })
    .uncheck();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await editor.press("ControlOrMeta+A");
  await editor.pressSequentially("[");
  await saved(page, "[");
  await page.reload();
  await expect(editor).toBeVisible();
  await workspaceAction(page, "Editor settings");
  await expect(
    dialog.getByRole("checkbox", { name: "Wrap selected text", exact: true }),
  ).not.toBeChecked();
});
