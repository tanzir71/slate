import { expect, test } from "./fixtures";
import {
  createSheet,
  openLibrary,
  expectSavedSheet as saved,
  readCurrentSheet,
  workspaceAction,
} from "./helpers";
import AxeBuilder from "@axe-core/playwright";

const fence = String.fromCharCode(96).repeat(3);

test("fence save assertions keep their deadline after one unavailable snapshot", async ({
  page,
}) => {
  await openLibrary(page);
  const original = "# Code\n\n" + fence;
  const editor = await createSheet(page, original);
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Code language", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText(
    "Saved",
  );
  const probe = { reads: 0, failures: 0 };
  const closed = original + "\n\n" + fence;
  await saved(page, closed, async (currentPage) => {
    probe.reads++;
    if (probe.failures === 0) {
      probe.failures++;
      await currentPage.evaluate(() => {
        throw new DOMException(
          "One unavailable fence snapshot",
          "NotFoundError",
        );
      });
    }
    return readCurrentSheet(currentPage);
  });
  expect(probe.failures).toBe(1);
  expect(probe.reads).toBeGreaterThanOrEqual(2);
  await page.reload();
  await expect(editor).toBeVisible();
  await saved(page, closed);
});

test("Enter closes a fence and language choice, cancel and redo preserve one undo", async ({
  page,
}) => {
  await openLibrary(page);
  const original = "# Code\n\n" + fence;
  const editor = await createSheet(page, original);
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  const picker = page.getByRole("dialog", {
    name: "Code language",
    exact: true,
  });
  await expect(picker).toBeVisible();
  await saved(page, original + "\n\n" + fence);
  expect(
    (
      await new AxeBuilder({ page })
        .include('dialog[aria-label="Code language"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  await picker.getByLabel("Code language", { exact: true }).fill("rust");
  await picker
    .getByRole("button", { name: "Set language", exact: true })
    .click();
  await expect(editor).toBeFocused();
  const chosen = original + "rust\n\n" + fence;
  await saved(page, chosen);
  await editor.press("ControlOrMeta+z");
  await saved(page, original);
  const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
  await editor.press(mac ? "Meta+Shift+z" : "Control+y");
  await saved(page, chosen);
  await editor.press("ControlOrMeta+z");
  await saved(page, original);
  await editor.press("Enter");
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await saved(page, original + "\n\n" + fence);
  await expect(editor).toBeFocused();
  await editor.press("ControlOrMeta+z");
  await saved(page, original);
});

test("front matter completes only at the first line and keeps later words", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "---\nKeep these words.");
  await editor.press("ControlOrMeta+Home");
  await editor.press("End");
  await editor.press("Enter");
  await saved(page, "---\n\n---\nKeep these words.");
  await page.keyboard.insertText("title: Notes");
  await saved(page, "---\ntitle: Notes\n---\nKeep these words.");
  await editor.press("ControlOrMeta+z");
  await saved(page, "---\n\n---\nKeep these words.");
  await editor.press("ControlOrMeta+z");
  await saved(page, "---\nKeep these words.");
});

test("fence and front-matter settings disable independently and persist", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "---");
  await workspaceAction(page, "Editor settings");
  const settings = page.getByRole("dialog", {
    name: "Editor settings",
    exact: true,
  });
  await settings
    .getByRole("checkbox", { name: "Create front matter", exact: true })
    .uncheck();
  await expect(
    settings.getByRole("checkbox", { name: "Close code fences", exact: true }),
  ).toBeChecked();
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await saved(page, "---\n");
  await expect(editor.getByText("---", { exact: true })).toBeVisible();
  await expect(editor.locator(".cm-slate-properties")).toHaveCount(0);
  await workspaceAction(page, "Editor settings");
  await settings
    .getByRole("checkbox", { name: "Close code fences", exact: true })
    .uncheck();
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  // DOM fill cannot reliably select source hidden by live-preview widgets.
  // Use the editor's select-all command to replace its complete document.
  await editor.press("ControlOrMeta+a");
  await page.keyboard.insertText(fence);
  await saved(page, fence);
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await saved(page, fence + "\n");
  await expect(
    page.getByRole("dialog", { name: "Code language", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  // Live preview hides an inactive opening fence; navigate to its actual source.
  await saved(page, fence + "\n");
  await editor.press("ControlOrMeta+Home");
  await expect(editor).toContainText(fence);
  await workspaceAction(page, "Editor settings");
  await expect(
    settings.getByRole("checkbox", {
      name: "Create front matter",
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    settings.getByRole("checkbox", { name: "Close code fences", exact: true }),
  ).not.toBeChecked();
});

test("rapid Enter without a DOM input delivery still completes the fence", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "");
  await page.clock.setFixedTime(new Date("2026-11-18T00:00:00Z"));
  await editor.pressSequentially(fence);
  await editor.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await expect(
    page.getByRole("dialog", { name: "Code language", exact: true }),
  ).toBeVisible();
  await saved(page, fence + "\n\n" + fence);
});
