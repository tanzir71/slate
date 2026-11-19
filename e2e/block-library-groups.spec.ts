import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  createSheet,
  expectSavedSheet,
  openLibrary,
  readCurrentSheet,
  replaceEditorText,
} from "./helpers";
import { libraryFile, libraryPaths } from "./libraryFiles";
const menu = (page: Page) =>
  page.getByRole("dialog", { name: "Insert block", exact: true });
const path = ".slate/templates/Team Review.md";
const template =
  '---\ntemplate:\n  name: Unique review\n  description: Review a draft\n  destination: "{{prompt:Folder}}"\n  filename: "{{unknown}}"\ntitle: "{{title}}"\n---\nHello {{prompt:Name|Sam}}\n\n{{cursor}}Next';
async function refresh(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}
async function query(page: Page, value: string) {
  await page.keyboard.press("Escape");
  await replaceEditorText(page, value);
  await page.locator(".cm-content").press("ControlOrMeta+End");
}
async function snippets(
  page: Page,
  body: string,
  name = "Linked greeting",
  expandOn: "tab" | "space" | "both" = "tab",
) {
  await libraryFile(
    page,
    ".slate/snippets.json",
    JSON.stringify({
      version: 1,
      snippets: [{ trigger: ";greet", name, body, expandOn }],
    }),
  );
  await refresh(page);
}
async function gate(page: Page, name: string) {
  await page.evaluate((name) => {
    const original = FileSystemFileHandle.prototype.getFile;
    let release = () => undefined as void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = {
      started: false,
      release: () => {
        FileSystemFileHandle.prototype.getFile = original;
        release();
      },
    };
    Object.assign(window, { slateGroupGate: state });
    FileSystemFileHandle.prototype.getFile = async function () {
      if (this.name === name) {
        state.started = true;
        await ready;
      }
      return original.call(this);
    };
  }, name);
}
async function release(page: Page) {
  await page.evaluate(() =>
    (
      window as Window & { slateGroupGate: { release(): void } }
    ).slateGroupGate.release(),
  );
}
async function started(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { slateGroupGate: { started: boolean } })
            .slateGroupGate.started,
      ),
    )
    .toBe(true);
}
async function writeOnly(page: Page, path: string, source: string) {
  await page.evaluate(
    async ({ path, source }) => {
      let directory = await (
        await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle("spaces")
      ).getDirectoryHandle(decodeURIComponent(location.hash.split("/")[2]!));
      const parts = path.split("/"),
        name = parts.pop()!;
      for (const part of parts)
        directory = await directory.getDirectoryHandle(part);
      const stream = await (
        await directory.getFileHandle(name)
      ).createWritable();
      await stream.write(source);
      await stream.close();
    },
    { path, source },
  );
}

test("template groups preview source, fill prompts and insert into the current sheet with one undo and offline reuse", async ({
  page,
  context,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "# Draft");
  const files = await libraryPaths(page);
  await libraryFile(page, path, template);
  await refresh(page);
  await query(page, "# Draft\n\n/Unique review");
  const option = menu(page).getByRole("option", { selected: true });
  await expect(option).toContainText("Unique review");
  const id = await option.getAttribute("id");
  expect(id).not.toMatch(/\s/);
  await expect(editor).toHaveAttribute("aria-activedescendant", id!);
  const icon = option.locator(".blockMenuAsset");
  const geometry = await icon.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    mask: getComputedStyle(element).maskImage,
  }));
  expect(geometry.width).toBe(16);
  expect(geometry.height).toBe(16);
  expect(geometry.mask).not.toBe("none");
  expect(geometry.mask).not.toContain("figma.com");
  await editor.press("Tab");
  await expect(menu(page).locator(".blockMarkdownPreview")).not.toContainText(
    "destination:",
  );
  expect(
    (
      await new AxeBuilder({ page })
        .include(".slateBlockMenu")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath("grouped-template-menu.png"),
  });
  await page.keyboard.press("Escape");
  await expectSavedSheet(page, "# Draft\n\n/Unique review");
  await query(page, "# Draft\n\n/Unique review");
  await editor.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Insert Unique review",
    exact: true,
  });
  await expect(
    dialog.getByRole("textbox", { name: "Folder", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("textbox", { name: "Template title", exact: true })
    .fill("Quarterly: review");
  await dialog
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("বাংলা 🙂");
  const currentURL = page.url();
  await page.keyboard.press("Alt+n");
  await expect(page).toHaveURL(currentURL);
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Insert template", exact: true })
    .click();
  const expected =
    '# Draft\n\n---\ntitle: "Quarterly: review"\n---\nHello বাংলা 🙂\n\nNext';
  await expectSavedSheet(page, expected);
  expect(await libraryPaths(page)).toEqual(files);
  await page.keyboard.insertText("HERE");
  await expectSavedSheet(page, expected.replace("Next", "HERENext"));
  await editor.press("ControlOrMeta+z");
  await expectSavedSheet(page, expected);
  await editor.press("ControlOrMeta+z");
  await expectSavedSheet(page, "# Draft\n\n/Unique review");
  await context.setOffline(true);
  await page.reload();
  await expect(editor).toBeVisible();
  await editor.press("ControlOrMeta+End");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Unique review");
  await editor.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expectSavedSheet(page, "# Draft\n\n/Unique review");
  await context.setOffline(false);
  expect(
    new TextDecoder().decode(new Uint8Array((await libraryFile(page, path))!)),
  ).toBe(template);
});

test("snippet groups keep linked fields and gutter separation in a single expansion transaction", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  await snippets(page, "Hello ${1:Name}; ${1}$0");
  await query(page, "/;greet");
  const option = menu(page).getByRole("option", { selected: true });
  await expect(option).toContainText("Linked greeting");
  const snippetIcon = await option
    .locator(".blockMenuAsset")
    .evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
      mask: getComputedStyle(element).maskImage,
    }));
  expect(snippetIcon.width).toBe(16);
  expect(snippetIcon.height).toBe(16);
  expect(snippetIcon.mask).not.toBe("none");
  expect(snippetIcon.mask).not.toContain("figma.com");
  await editor.press("Enter");
  await expectSavedSheet(page, "Hello Name; Name");
  await page.keyboard.insertText("Rafi");
  await expectSavedSheet(page, "Hello Rafi; Rafi");
  await editor.press("ControlOrMeta+z");
  await expectSavedSheet(page, "Hello Name; Name");
  await editor.press("ControlOrMeta+z");
  await expectSavedSheet(page, "/;greet");
  const fence = "```md\nliteral\n```";
  await query(page, fence);
  await snippets(page, "\uFEFFHello ${1:Name}; ${1}$0");
  await editor.press("ControlOrMeta+End");
  await page
    .getByRole("button", { name: "Block actions", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("dialog", { name: "Block actions", exact: true })
    .getByRole("button", { name: "Insert block after", exact: true })
    .click();
  const search = menu(page).getByRole("combobox", {
    name: "Find a block",
    exact: true,
  });
  await search.fill("Linked greeting");
  await search.press("Enter");
  await expectSavedSheet(page, fence + "\n\n\uFEFFHello Name; Name");
  await page.keyboard.insertText("বাংলা 🙂");
  await expectSavedSheet(page, fence + "\n\n\uFEFFHello বাংলা 🙂; বাংলা 🙂");
  await editor.press("ControlOrMeta+z");
  await expectSavedSheet(page, fence + "\n\n\uFEFFHello Name; Name");
  await editor.press("ControlOrMeta+z");
  await expectSavedSheet(page, fence);
});

test("grouped snippet prompts keep clipboard text literal and preserve numbered field navigation", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  await snippets(
    page,
    "{{prompt:Person|Sam}} says ${1:hello}$0 — {{clipboard}}",
    "Greeting prompt",
  );
  await query(page, "/;greet");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Greeting prompt");
  await editor.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Insert Greeting prompt",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Person", exact: true })
    .fill("বাংলা 🙂");
  await dialog
    .getByRole("textbox", { name: "Clipboard text", exact: true })
    .fill("${1:raw}");
  await dialog
    .getByRole("button", { name: "Insert snippet", exact: true })
    .click();
  await expectSavedSheet(page, "বাংলা 🙂 says hello — ${1:raw}");
  await page.keyboard.insertText("Hi");
  await editor.press("Tab");
  await page.keyboard.insertText("!");
  await expectSavedSheet(page, "বাংলা 🙂 says Hi! — ${1:raw}");
});

test("an explicit template choice re-reads its file and rejects a changed source before insertion", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  await libraryFile(page, path, template);
  await refresh(page);
  await query(page, "/Unique review");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Unique review");
  await gate(page, "Team Review.md");
  await editor.press("Enter");
  await started(page);
  await writeOnly(page, path, "> Fresh source");
  await release(page);
  await expect(page.locator(".blockMenuError")).toContainText("changed");
  await expectSavedSheet(page, "/Unique review");
  await page
    .locator(".blockMenuError")
    .getByRole("button", { name: "Dismiss", exact: true })
    .click();
  await query(page, "/Team Review");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Team Review");
  await editor.press("Enter");
  await expectSavedSheet(page, "> Fresh source");
});

test("a prompt with an invalid default stays editable and can insert corrected properties", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  await libraryFile(
    page,
    path,
    '---\ntemplate:\n  name: Property key\n"{{prompt:Key|template}}": value\n---\nBody',
  );
  await refresh(page);
  await query(page, "/Property key");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Property key");
  await editor.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Insert Property key",
    exact: true,
  });
  await expect(dialog.getByRole("alert")).toContainText(
    "reserved template key",
  );
  await dialog
    .getByRole("textbox", { name: "Key", exact: true })
    .fill("status");
  await dialog
    .getByRole("button", { name: "Insert template", exact: true })
    .click();
  await expectSavedSheet(page, '---\n"status": value\n---\nBody');
});

test("template fields retain answers and reject insertion when another tab takes ownership", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  await libraryFile(page, path, template);
  await refresh(page);
  await query(page, "/Unique review");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Unique review");
  await editor.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Insert Unique review",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Kept answer");
  const reader = await context.newPage();
  await reader.goto(page.url());
  await reader.getByRole("button", { name: "Use here", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Insert template", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("read-only");
  await expect(
    dialog.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Kept answer");
  await expect(async () => {
    expect(await readCurrentSheet(page)).toBe("/Unique review");
  }).toPass({ timeout: 5000 });
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText(
    "Read-only",
  );
  await reader.close();
});

test("selected-folder templates and snippets insert through the real directory without creating another sheet", async ({
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
        ).getDirectoryHandle("grouped-folder", { create: true });
        const config = await folder.getDirectoryHandle(".slate", {
          create: true,
        });
        const templates = await config.getDirectoryHandle("templates", {
          create: true,
        });
        const fragment = await (
          await templates.getFileHandle("Folder item.md", { create: true })
        ).createWritable();
        await fragment.write("> Folder template");
        await fragment.close();
        const snippets = await (
          await config.getFileHandle("snippets.json", { create: true })
        ).createWritable();
        await snippets.write(
          JSON.stringify({
            version: 1,
            snippets: [
              {
                trigger: ";folder",
                name: "Folder snippet",
                body: "Folder ${1:Name}$0",
              },
            ],
          }),
        );
        await snippets.close();
        const note = await (
          await folder.getFileHandle("Note.md", { create: true })
        ).createWritable();
        await note.write("/Folder item");
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
  await editor.press("ControlOrMeta+End");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Folder item");
  await editor.press("Enter");
  const readNote = () =>
    page.evaluate(async () =>
      (
        await (
          await (
            await (
              await navigator.storage.getDirectory()
            ).getDirectoryHandle("grouped-folder")
          ).getFileHandle("Note.md")
        ).getFile()
      ).text(),
    );
  await expect(async () => {
    expect(await readNote()).toBe("> Folder template");
  }).toPass({ timeout: 5000 });
  await editor.press("ControlOrMeta+z");
  await expect(async () => {
    expect(await readNote()).toBe("/Folder item");
  }).toPass({ timeout: 5000 });
  await query(page, "/;folder");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Folder snippet");
  await editor.press("Enter");
  await expect(async () => {
    expect(await readNote()).toBe("Folder Name");
  }).toPass({ timeout: 5000 });
  await page.keyboard.insertText("বাংলা 🙂");
  await editor.press("Tab");
  await expect(async () => {
    expect(await readNote()).toBe("Folder বাংলা 🙂");
  }).toPass({ timeout: 5000 });
  expect(
    await page.evaluate(async () => {
      const folder = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle("grouped-folder"),
        paths: string[] = [];
      for await (const [name, handle] of folder.entries())
        if (handle.kind === "file") paths.push(name);
      return paths;
    }),
  ).toEqual(["Note.md"]);
});

test("an explicit snippet choice rejects a newer configuration before expanding fields", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  await snippets(page, "Old ${1:Name}$0", "Mutable snippet");
  await query(page, "/;greet");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Mutable snippet");
  await gate(page, "snippets.json");
  await editor.press("Enter");
  await started(page);
  await writeOnly(
    page,
    ".slate/snippets.json",
    JSON.stringify({
      version: 1,
      snippets: [
        { trigger: ";greet", name: "Mutable snippet", body: "New ${1:Name}$0" },
      ],
    }),
  );
  await release(page);
  await expect(page.locator(".blockMenuError")).toContainText(
    "snippet changed",
  );
  await expectSavedSheet(page, "/;greet");
  await page
    .locator(".blockMenuError")
    .getByRole("button", { name: "Dismiss", exact: true })
    .click();
  await query(page, "/;greet");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Mutable snippet");
  await editor.press("Enter");
  await expectSavedSheet(page, "New Name");
});

test("external note changes leave an open template form intact and reject its stale editor request", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  await libraryFile(page, path, template);
  await refresh(page);
  await query(page, "/Unique review");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Unique review");
  await editor.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Insert Unique review",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Kept answer");
  await expectSavedSheet(page, "/Unique review");
  const notePath = decodeURIComponent(page.url().split("/sheet/")[1]!);
  await libraryFile(page, notePath, "> External writing");
  // Visible external-change polling is every five seconds; allow its next complete cycle.
  await expect(editor).toContainText("External writing", { timeout: 10_000 });
  await dialog
    .getByRole("button", { name: "Insert template", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("sheet changed");
  await expect(
    dialog.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Kept answer");
  await expectSavedSheet(page, "> External writing");
});

test("gutter definitions reject a changed editor selection before capturing template variables", async ({
  page,
}) => {
  await openLibrary(page);
  const original = "First\n\nLast",
    editor = await createSheet(page, original);
  await snippets(page, "Echo {{selection}}$0", "Selection fixture");
  await editor.press("ControlOrMeta+End");
  await page
    .getByRole("button", { name: "Block actions", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("dialog", { name: "Block actions", exact: true })
    .getByRole("button", { name: "Insert block after", exact: true })
    .click();
  const search = menu(page).getByRole("combobox", {
    name: "Find a block",
    exact: true,
  });
  await search.fill("Selection fixture");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Selection fixture");
  await editor.press("ControlOrMeta+Home");
  await search.focus();
  await search.press("Enter");
  await expect(page.locator(".blockMenuError")).toContainText(
    "selection changed",
  );
  await expectSavedSheet(page, original);
});

test("Space-activated snippets leave Space in a slash query until Enter chooses the result", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  await snippets(page, "Space ${1:Name}$0", "Space fixture", "space");
  await query(page, "Words ;greet");
  await editor.press("Space");
  await expectSavedSheet(page, "Words Space Name");
  await editor.press("ControlOrMeta+z");
  await query(page, "/;greet");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Space fixture");
  await editor.press("Space");
  await expectSavedSheet(page, "/;greet ");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Space fixture");
  await editor.press("Enter");
  await expectSavedSheet(page, "Space Name");
  await editor.press("ControlOrMeta+z");
  await expectSavedSheet(page, "/;greet ");
});
