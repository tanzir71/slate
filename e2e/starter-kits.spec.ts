import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  chooseAppearance,
  createSheet,
  openLibrary,
  readCurrentSheet,
  showSheets,
  workspaceAction,
} from "./helpers";
import { libraryFile, libraryPaths } from "./libraryFiles";

async function kits(page: Page) {
  const invoker = await workspaceAction(page, "Starter kits");
  const dialog = page.getByRole("dialog", {
    name: "Starter kits",
    exact: true,
  });
  await expect(
    dialog.getByRole("combobox", { name: "Starter kit", exact: true }),
  ).toBeFocused();
  return { dialog, invoker };
}
const text = (bytes: number[] | undefined) =>
  new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes!));

for (const [id, name, folder, template] of [
  ["work", "Work", "Meetings", "builtin:meeting-notes"],
  ["writing", "Writing", "Drafts", "builtin:blog-post"],
  ["engineering", "Engineering", "Projects", "builtin:readme"],
  ["personal", "Personal", "Reviews", "builtin:weekly-review"],
] as const) {
  test(`${name} kit creates real notes and defaults in a separate notebook, then reopens exactly`, async ({
    page,
  }, testInfo) => {
    await page.clock.setFixedTime(new Date(2026, 10, 19, 9, 30));
    await openLibrary(page);
    await createSheet(page, "Keep the original.");
    await libraryFile(
      page,
      name.toLowerCase() + "/keep.md",
      "Keep these existing words.",
    );
    await libraryFile(
      page,
      ".slate/view.json",
      '{"version":1,"custom":"External setting","notebookTemplates":{"Other":"builtin:readme"}}',
    );
    const { dialog } = await kits(page);
    await dialog
      .getByRole("combobox", { name: "Starter kit", exact: true })
      .selectOption(id);
    await expect(
      dialog.getByRole("textbox", { name: "Notebook name", exact: true }),
    ).toHaveValue(name);
    await expect(
      dialog
        .getByRole("region", { name: "Kit contents", exact: true })
        .getByRole("listitem"),
    ).toHaveCount(3);
    if (id === "work") {
      if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
        for (const target of [
          dialog.getByRole("textbox", { name: "Notebook name", exact: true }),
          dialog.getByRole("combobox", { name: "Starter kit", exact: true }),
          dialog.getByRole("button", {
            name: "Close Starter kits",
            exact: true,
          }),
          dialog.getByRole("button", { name: "Add kit", exact: true }),
        ]) {
          const box = await target.boundingBox();
          expect(box!.width).toBeGreaterThanOrEqual(44);
          expect(box!.height).toBeGreaterThanOrEqual(44);
        }
      }
      expect(
        (
          await new AxeBuilder({ page })
            .include(".starterKitDialog")
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await testInfo.attach("starter-kits-light", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    }
    await dialog.getByRole("button", { name: "Add kit", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const root = name + " (1)";
    await expect(page).toHaveURL(
      new RegExp(
        encodeURIComponent(root + "/Overview.md").replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        ) + "$",
      ),
    );
    const editor = page.locator(".cm-content");
    await expect(editor).toBeFocused();
    const overview = await readCurrentSheet(page);
    expect(overview).toContain("# " + name);
    const paths = (await libraryPaths(page)).filter((path) =>
      path.startsWith(root + "/"),
    );
    expect(paths).toHaveLength(3);
    for (const path of paths.filter((path) => !path.endsWith("/Overview.md"))) {
      const source = text(await libraryFile(page, path));
      expect(source).not.toMatch(/template:|\{\{/);
      expect(source).toContain('date: "2026-11-19"');
    }
    const preferences = JSON.parse(
      text(await libraryFile(page, ".slate/view.json")),
    );
    expect(preferences.custom).toBe("External setting");
    expect(preferences.notebookTemplates.Other).toBe("builtin:readme");
    expect(preferences.notebookTemplates[root + "/" + folder]).toBe(template);
    expect(text(await libraryFile(page, name.toLowerCase() + "/keep.md"))).toBe(
      "Keep these existing words.",
    );
    expect(text(await libraryFile(page, "Inbox/Untitled.md"))).toBe(
      "Keep the original.",
    );
    if (id === "work") {
      await showSheets(page);
      await page.getByRole("button", { name: /^Weekly sync\b/ }).click();
      const notebook = page.getByRole("button", {
        name: "Notebook " + root + "/Meetings",
        exact: true,
        includeHidden: true,
      });
      await expect(notebook).toBeAttached();
      if (!(await notebook.isVisible()))
        await page
          .getByRole("button", { name: "Show navigation", exact: true })
          .click();
      await notebook.click();
      await page.keyboard.press("Alt+n");
      const gallery = page.getByRole("dialog", {
        name: "New from template",
        exact: true,
      });
      await expect(
        gallery.getByRole("combobox", { name: "Notebook", exact: true }),
      ).toHaveValue(root + "/Meetings");
      await gallery
        .getByRole("textbox", { name: "Title", exact: true })
        .fill("Follow-up");
      await gallery
        .getByRole("button", { name: "Create ↵", exact: true })
        .click();
      await expect(gallery).toHaveCount(0);
      await expect(page).toHaveURL(/2026-11-19-follow-up\.md$/);
      expect(await readCurrentSheet(page)).toContain("## Agenda");
    }
    const saved = await readCurrentSheet(page);
    const url = page.url();
    await page.reload();
    await expect(page.locator(".cm-content")).toBeVisible();
    await expect(page).toHaveURL(url);
    expect(await readCurrentSheet(page)).toBe(saved);
  });
}

test("cancelling and invalid names create no files; a pristine new template can open kits without discarding edited source", async ({
  page,
}, testInfo) => {
  await openLibrary(page);
  await createSheet(page, "Original words.");
  await chooseAppearance(page, "dark");
  const { dialog, invoker } = await kits(page);
  await testInfo.attach("starter-kits-dark", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await dialog
    .getByRole("textbox", { name: "Notebook name", exact: true })
    .fill("../outside");
  await dialog.getByRole("button", { name: "Add kit", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(await libraryPaths(page)).toEqual(["Inbox/Untitled.md"]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(invoker).toBeFocused();
  await page.keyboard.press("Alt+Shift+n");
  const gallery = page.getByRole("dialog", {
    name: "New from template",
    exact: true,
  });
  await gallery
    .getByRole("button", { name: "Add template", exact: true })
    .click();
  const browse = gallery.getByRole("button", {
    name: "Browse starter kits",
    exact: true,
  });
  await expect(browse).toBeVisible();
  const source = gallery.getByRole("textbox", {
    name: "Template source",
    exact: true,
  });
  const original = await source.inputValue();
  await source.fill(original + "\nMy unsaved template text.");
  await expect(browse).toHaveCount(0);
  await source.fill(original);
  await browse.click();
  await expect(gallery).toHaveCount(0);
  await expect(
    dialog.getByRole("combobox", { name: "Starter kit", exact: true }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await libraryPaths(page)).toEqual(["Inbox/Untitled.md"]);
});

async function failProjectOnce(page: Page) {
  await page.evaluate(() => {
    const original = FileSystemFileHandle.prototype.createWritable;
    let failed = false;
    FileSystemFileHandle.prototype.createWritable = function (...args) {
      if (this.name === "Project outline.md" && !failed) {
        failed = true;
        return Promise.reject(
          new DOMException("One interrupted kit write", "QuotaExceededError"),
        );
      }
      return original.apply(this, args);
    };
  });
}

test("retry resumes a partially saved kit, keeps the interrupted file and preserves edits to completed notes", async ({
  page,
}) => {
  await openLibrary(page);
  await createSheet(page, "Original words.");
  await failProjectOnce(page);
  const { dialog } = await kits(page);
  await dialog.getByRole("button", { name: "Add kit", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "One interrupted kit write",
  );
  await expect(dialog.getByRole("status")).toContainText(
    "2 of 3 notes saved in Work",
  );
  await libraryFile(page, "Work/Overview.md", "My external overview words.");
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/Work%2FOverview\.md$/);
  expect(await readCurrentSheet(page)).toBe("My external overview words.");
  expect(await libraryFile(page, "Work/Projects/Project outline.md")).toEqual(
    [],
  );
  expect(
    text(await libraryFile(page, "Work/Projects/Project outline (1).md")),
  ).toContain("## Problem");
  expect(
    (await libraryPaths(page)).filter((path) => path.startsWith("Work/")),
  ).toHaveLength(4);
  expect(text(await libraryFile(page, ".slate/view.json"))).toContain(
    "builtin:prd",
  );
});

test("closing after an interrupted kit keeps all files and a later installation uses another notebook", async ({
  page,
}) => {
  await openLibrary(page);
  await createSheet(page, "Original words.");
  await failProjectOnce(page);
  let { dialog } = await kits(page);
  await dialog.getByRole("button", { name: "Add kit", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Close and keep files", exact: true })
    .click();
  const kept = (await libraryPaths(page)).filter((path) =>
    path.startsWith("Work/"),
  );
  expect(kept).toHaveLength(3);
  ({ dialog } = await kits(page));
  await dialog.getByRole("button", { name: "Add kit", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/Work%20\(1\)%2FOverview\.md$/);
  expect(
    (await libraryPaths(page)).filter((path) => path.startsWith("Work/")),
  ).toEqual(kept);
  expect(
    (await libraryPaths(page)).filter((path) => path.startsWith("Work (1)/")),
  ).toHaveLength(3);
});

test("Folder tier adds a starter kit and portable notebook defaults beside the user's files", async ({
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
      value: async () =>
        (await navigator.storage.getDirectory()).getDirectoryHandle(
          "kit-folder",
          { create: true },
        ),
    }),
  );
  await page.goto("./");
  await page.getByText("Open a folder", { exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const { dialog } = await kits(page);
  await dialog
    .getByRole("combobox", { name: "Starter kit", exact: true })
    .selectOption("engineering");
  await dialog
    .getByRole("textbox", { name: "Notebook name", exact: true })
    .fill("আমার কাজ");
  await dialog.getByRole("button", { name: "Add kit", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const result = await page.evaluate(async () => {
    const folder = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle("kit-folder");
    const projects = await (
      await folder.getDirectoryHandle("আমার কাজ")
    ).getDirectoryHandle("Projects");
    const properties = await folder.getDirectoryHandle(".slate");
    return {
      note: await (
        await (await projects.getFileHandle("Project README.md")).getFile()
      ).text(),
      preferences: await (
        await (await properties.getFileHandle("view.json")).getFile()
      ).text(),
    };
  });
  expect(result.note).toContain("## Installation");
  expect(result.note).not.toContain("template:");
  expect(
    JSON.parse(result.preferences).notebookTemplates["আমার কাজ/Projects"],
  ).toBe("builtin:readme");
});

test("a cold starter-kit dialog and its templates work offline and reopen saved writing", async ({
  page,
  context,
}) => {
  await openLibrary(page);
  await createSheet(page, "Original offline words.");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  try {
    const { dialog } = await kits(page);
    await dialog
      .getByRole("combobox", { name: "Starter kit", exact: true })
      .selectOption("personal");
    await dialog.getByRole("button", { name: "Add kit", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/Personal%2FOverview\.md$/);
    const source = await readCurrentSheet(page);
    expect(source).toContain("# Personal");
    await page.reload();
    await expect(page.locator(".cm-content")).toBeVisible();
    expect(await readCurrentSheet(page)).toBe(source);
    expect(text(await libraryFile(page, ".slate/view.json"))).toContain(
      "builtin:weekly-review",
    );
  } finally {
    await context.setOffline(false);
  }
});

test("the kit dialog can reclaim write ownership without losing the selected setup", async ({
  page,
  context,
}) => {
  // Match the existing ownership story's allowance for two cold tabs and a lease handoff.
  test.setTimeout(60_000);
  await openLibrary(page);
  await createSheet(page, "Original ownership words.");
  const { dialog } = await kits(page);
  await dialog
    .getByRole("combobox", { name: "Starter kit", exact: true })
    .selectOption("writing");
  await dialog
    .getByRole("textbox", { name: "Notebook name", exact: true })
    .fill("My drafts");
  const other = await context.newPage();
  await other.goto("./");
  await expect(
    other.getByText("Slate is open in another tab", { exact: false }),
  ).toBeVisible();
  await other.getByRole("button", { name: "Use here", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Add kit", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Use here", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Use here", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Add kit", exact: true }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("textbox", { name: "Notebook name", exact: true }),
  ).toHaveValue("My drafts");
  await dialog.getByRole("button", { name: "Add kit", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/My%20drafts%2FOverview\.md$/);
  expect(await readCurrentSheet(page)).toContain("# Writing");
  expect(text(await libraryFile(page, "Inbox/Untitled.md"))).toBe(
    "Original ownership words.",
  );
  await expect(other.locator(".cm-content")).toHaveAttribute(
    "contenteditable",
    "false",
  );
});
