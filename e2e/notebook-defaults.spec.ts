import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  createSheet,
  openLibrary,
  readCurrentSheet,
  workspaceAction,
} from "./helpers";

async function file(page: Page, path: string, text?: string) {
  return page.evaluate(
    async ({ path, text }) => {
      let directory = await (
        await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle("spaces")
      ).getDirectoryHandle(decodeURIComponent(location.hash.split("/")[2]!));
      const parts = path.split("/"),
        name = parts.pop()!;
      for (const part of parts)
        directory = await directory.getDirectoryHandle(part, {
          create: text !== undefined,
        });
      const handle = await directory.getFileHandle(name, {
        create: text !== undefined,
      });
      if (text !== undefined) {
        const stream = await handle.createWritable();
        await stream.write(text);
        await stream.close();
      }
      return (await handle.getFile()).text();
    },
    { path, text },
  );
}
async function settings(page: Page) {
  await workspaceAction(page, "Notebook default template");
  const dialog = page.getByRole("dialog", {
    name: "Notebook default template",
    exact: true,
  });
  await expect(
    dialog.getByRole("combobox", { name: "Default template", exact: true }),
  ).toBeEnabled();
  return dialog;
}

test("a notebook's keyboard settings select its default and create inside that notebook", async ({
  page,
}, testInfo) => {
  await openLibrary(page);
  await createSheet(page, "Original words.");
  await file(page, "Work/Existing.md", "Keep these Work words.");
  await page.reload();
  const notebook = page.getByRole("button", {
    name: "Notebook Work",
    exact: true,
    includeHidden: true,
  });
  await expect(notebook).toBeAttached();
  if (!(await notebook.isVisible()))
    await page
      .getByRole("button", { name: "Show navigation", exact: true })
      .click();
  await notebook.press("Shift+F10");
  const settingsDialog = page.getByRole("dialog", {
    name: "Notebook default template",
    exact: true,
  });
  const field = settingsDialog.getByRole("combobox", {
    name: "Default template",
    exact: true,
  });
  await expect(field).toBeFocused();
  await field.selectOption("builtin:meeting-notes");
  await testInfo.attach("notebook-default-light", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await settingsDialog
    .getByRole("button", { name: "Save default", exact: true })
    .click();
  await expect(settingsDialog).toHaveCount(0);
  expect(JSON.parse(await file(page, ".slate/view.json"))).toMatchObject({
    notebookTemplates: { Work: "builtin:meeting-notes" },
  });
  await notebook.click();
  const oldURL = page.url();
  await page.keyboard.press("Alt+n");
  const gallery = page.getByRole("dialog", {
    name: "New from template",
    exact: true,
  });
  await expect(
    gallery.getByRole("textbox", { name: "Title", exact: true }),
  ).toBeFocused();
  await expect(
    gallery.getByRole("combobox", { name: "Notebook", exact: true }),
  ).toHaveValue("Work");
  await gallery
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Notebook review");
  await gallery.getByLabel("Date", { exact: true }).fill("2026-11-19");
  await gallery.getByRole("button", { name: "Create ↵", exact: true }).click();
  await expect(page).not.toHaveURL(oldURL);
  expect(decodeURIComponent(page.url())).toContain(
    "Work/2026-11-19-notebook-review.md",
  );
  const source = await readCurrentSheet(page);
  expect(source).toContain("## Agenda");
  expect(source).not.toContain("template:");
  expect(await file(page, "Inbox/Untitled.md")).toBe("Original words.");
});

test("external Space defaults are read on New Sheet and focus their first field after loading", async ({
  page,
}) => {
  await openLibrary(page);
  await createSheet(page, "Keep me.");
  await file(
    page,
    ".slate/templates/kickoff.md",
    '---\ntemplate:\n  name: Kickoff\n  category: Clients\n  destination: Elsewhere\n  filename: "{{title|slug}}"\n---\n# {{title}}\n\nOwner: {{prompt:Owner|Name}}\n\n{{cursor}}',
  );
  await file(
    page,
    ".slate/view.json",
    '{"version":1,"notebookTemplates":{"Inbox":".slate/templates/kickoff.md"}}',
  );
  await page.keyboard.press("Alt+n");
  const gallery = page.getByRole("dialog", {
    name: "New from template",
    exact: true,
  });
  const title = gallery.getByRole("textbox", { name: "Title", exact: true });
  await expect(title).toBeFocused();
  await expect(
    gallery.getByRole("heading", { name: "Kickoff", exact: true }),
  ).toBeVisible();
  await expect(
    gallery.getByRole("combobox", { name: "Notebook", exact: true }),
  ).toHaveValue("Inbox");
  await title.fill("Client start");
  await gallery
    .getByRole("textbox", { name: "Owner", exact: true })
    .fill("বাংলা");
  await gallery.getByRole("button", { name: "Create ↵", exact: true }).click();
  await expect(page).toHaveURL(/\/sheet\/Inbox%2Fclient-start\.md$/);
  expect(await readCurrentSheet(page)).toBe(
    "# Client start\n\nOwner: বাংলা\n\n",
  );
});

test("cancelling settings preserves a default; clearing it restores blank creation and keeps other preferences", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() =>
    localStorage.setItem("slate.appearance", "dark"),
  );
  await openLibrary(page);
  await createSheet(page, "Kept.");
  await file(
    page,
    ".slate/view.json",
    '{"version":1,"notebookTemplates":{"Inbox":"builtin:prd","Work":"builtin:readme"},"custom":"keep"}',
  );
  const dialog = await settings(page);
  await expect(
    dialog.getByRole("combobox", { name: "Default template", exact: true }),
  ).toHaveValue("builtin:prd");
  const accessibility = await new AxeBuilder({ page })
    .include('dialog[aria-label="Notebook default template"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await testInfo.attach("notebook-default-dark", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await dialog
    .getByRole("combobox", { name: "Default template", exact: true })
    .selectOption("");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(JSON.parse(await file(page, ".slate/view.json"))).toMatchObject({
    notebookTemplates: { Inbox: "builtin:prd" },
  });
  await settings(page);
  await dialog
    .getByRole("combobox", { name: "Default template", exact: true })
    .selectOption("");
  await dialog
    .getByRole("button", { name: "Save default", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const oldURL = page.url();
  await page.keyboard.press("Alt+n");
  await expect(page).not.toHaveURL(oldURL);
  expect(await readCurrentSheet(page)).toBe("");
  expect(JSON.parse(await file(page, ".slate/view.json"))).toMatchObject({
    notebookTemplates: { Work: "builtin:readme" },
    custom: "keep",
  });
});

for (const broken of [false, true]) {
  test(
    (broken ? "broken" : "missing") +
      " default templates remain visible and do not create a blank note",
    async ({ page }) => {
      await openLibrary(page);
      await createSheet(page, "Kept words.");
      const path = ".slate/templates/unavailable.md";
      if (broken) await file(page, path, "---\ntemplate: [");
      await file(
        page,
        ".slate/view.json",
        JSON.stringify({ version: 1, notebookTemplates: { Inbox: path } }),
      );
      const oldURL = page.url();
      await page.keyboard.press("Alt+n");
      const gallery = page.getByRole("dialog", {
        name: "New from template",
        exact: true,
      });
      await expect(gallery.getByRole("alert")).toContainText(
        broken
          ? "original file is unchanged"
          : "default template is unavailable",
      );
      await page.keyboard.press("Escape");
      await expect(gallery).toHaveCount(0);
      expect(page.url()).toBe(oldURL);
      expect(await readCurrentSheet(page)).toBe("Kept words.");
      if (broken) expect(await file(page, path)).toBe("---\ntemplate: [");
    },
  );
}

test("a Folder Space applies its default before creating its first sheet", async ({
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
        ).getDirectoryHandle("notebook-default-folder", { create: true });
        const privateDirectory = await folder.getDirectoryHandle(".slate", {
          create: true,
        });
        const stream = await (
          await privateDirectory.getFileHandle("view.json", { create: true })
        ).createWritable();
        await stream.write(
          '{"version":1,"notebookTemplates":{"Inbox":"builtin:meeting-notes"}}',
        );
        await stream.close();
        return folder;
      },
    }),
  );
  await page.goto("./");
  await page.getByText("Open a folder", { exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "New Sheet", exact: true })
    .first()
    .click();
  const gallery = page.getByRole("dialog", {
    name: "New from template",
    exact: true,
  });
  await expect(
    gallery.getByRole("combobox", { name: "Notebook", exact: true }),
  ).toHaveValue("Inbox");
  await gallery
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("First meeting");
  await gallery.getByLabel("Date", { exact: true }).fill("2026-11-19");
  await gallery.getByRole("button", { name: "Create ↵", exact: true }).click();
  await expect(gallery).toHaveCount(0);
  const source = await page.evaluate(async () => {
    const inbox = await (
      await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle("notebook-default-folder")
    ).getDirectoryHandle("Inbox");
    return (
      await (await inbox.getFileHandle("2026-11-19-first-meeting.md")).getFile()
    ).text();
  });
  expect(source).toContain("## Agenda");
  expect(source).not.toContain("template:");
});
