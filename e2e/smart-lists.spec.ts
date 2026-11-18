import { AxeBuilder } from "@axe-core/playwright";
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

test("smart lists move children, indent and preserve counter alignment with one undo", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openLibrary(page);
  const original = "- A\n- B\n  - Child";
  const editor = await createSheet(page, original);
  await editor.press("ControlOrMeta+Home");
  await editor.press("ArrowDown");
  await editor.press("End");
  await editor.press("Alt+ArrowUp");
  await saved(page, "- B\n  - Child\n- A");
  await editor.press("ControlOrMeta+z");
  await saved(page, original);
  await editor.press("Tab");
  await saved(page, "- A\n  - B\n    - Child");
  await editor.press("ControlOrMeta+z");
  await saved(page, original);
  const numbered = "8. Alpha\n9. Beta\n   - Child";
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText(numbered);
  await editor.press("ControlOrMeta+Home");
  await editor.press("End");
  await editor.press("Enter");
  await saved(page, "8. Alpha\n9. \n10. Beta\n    - Child");
  await editor.press("ControlOrMeta+z");
  await saved(page, numbered);
  await page.reload();
  await expect(editor).toBeVisible();
  await saved(page, numbered);
});

test("editor settings disable smart input immediately and survive reopening", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openLibrary(page);
  const original = "- A\n- B";
  const editor = await createSheet(page, original);
  await workspaceAction(page, "Editor settings");
  const dialog = page.getByRole("dialog", {
    name: "Editor settings",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", { name: "Continue lists and quotes" }),
  ).toBeFocused();
  for (const name of [
    "Continue lists and quotes",
    "Indent list items",
    "Move list items with children",
  ])
    await dialog.getByRole("checkbox", { name, exact: true }).uncheck();
  expect(
    (
      await new AxeBuilder({ page })
        .include('dialog[aria-label="Editor settings"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await saved(page, original + "\n");
  await editor.press("ControlOrMeta+z");
  await saved(page, original);
  await page.reload();
  await expect(editor).toBeVisible();
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await saved(page, original + "\n");
  await editor.press("ControlOrMeta+,");
  await expect(dialog).toBeVisible();
  for (const checkbox of await dialog.getByRole("checkbox").all())
    await expect(checkbox).not.toBeChecked();
});
