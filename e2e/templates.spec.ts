import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  createSheet,
  openLibrary,
  readCurrentSheet,
  workspaceAction,
} from "./helpers";

async function gallery(page: Page) {
  await workspaceAction(page, "New from template");
  const dialog = page.getByRole("dialog", {
    name: "New from template",
    exact: true,
  });
  await expect(
    dialog.getByRole("textbox", { name: "Title", exact: true }),
  ).toBeFocused();
  await expect(dialog.getByText("Reading Space templates…")).toHaveCount(0);
  return dialog;
}
async function spaceFile(page: Page, path: string, text?: string) {
  return page.evaluate(
    async ({ path, text }) => {
      const root = await navigator.storage.getDirectory();
      let folder = await (
        await root.getDirectoryHandle("spaces")
      ).getDirectoryHandle(decodeURIComponent(location.hash.split("/")[2]!));
      const parts = path.split("/"),
        name = parts.pop()!;
      for (const part of parts)
        folder = await folder.getDirectoryHandle(part, {
          create: text !== undefined,
        });
      const handle = await folder.getFileHandle(name, {
        create: text !== undefined,
      });
      if (text !== undefined) {
        const writer = await handle.createWritable();
        await writer.write(text);
        await writer.close();
      }
      return (await handle.getFile()).text();
    },
    { path, text },
  );
}

test("template gallery creates a routed note, strips configuration and places the caret exactly", async ({
  page,
}) => {
  await openLibrary(page);
  await createSheet(page, "Original note kept.");
  const previous = page.url();
  const dialog = await gallery(page);
  await dialog
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Design review — editor v2");
  await dialog.getByLabel("Date", { exact: true }).fill("2026-11-17");
  await expect(
    dialog.getByRole("combobox", { name: "Notebook", exact: true }),
  ).toHaveValue("product/meetings");
  await dialog.getByRole("button", { name: "Create ↵", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(previous);
  expect(decodeURIComponent(page.url())).toContain(
    "product/meetings/2026-11-17-design-review-editor-v2.md",
  );
  const source = await readCurrentSheet(page);
  expect(source).not.toMatch(/template:|\{\{/);
  expect(source).toContain('title: "Design review — editor v2"');
  expect(source).toContain('date: "2026-11-17"');
  expect(source).toContain("## Agenda\n- \n");
  await expect(page.locator(".cm-content")).toBeFocused();
  await page.keyboard.insertText("Discuss keyboard flow.");
  await expect(async () =>
    expect(await readCurrentSheet(page)).toBe(
      source.replace(
        "## Agenda\n- \n",
        "## Agenda\n- Discuss keyboard flow.\n",
      ),
    ),
  ).toPass({ timeout: 5_000 });
  expect(await spaceFile(page, "Inbox/Untitled.md")).toBe(
    "Original note kept.",
  );
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText(
    "Discuss keyboard flow.",
  );
});

test("gallery preview, original icons and accessibility work before any sheet exists", async ({
  page,
}, testInfo) => {
  await openLibrary(page);
  const dialog = await gallery(page);
  await dialog
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Design review — editor v2");
  await dialog.getByLabel("Date", { exact: true }).fill("2026-11-17");
  await expect(dialog.locator(".templateCard")).toHaveCount(5);
  await expect(dialog.locator(".templateVariable")).toHaveText([
    "{{title}}",
    "{{date}}",
    "{{cursor}}",
  ]);
  expect(
    await dialog
      .locator(".templateIcon")
      .evaluateAll((icons) =>
        icons.map((icon) => getComputedStyle(icon).maskImage),
      ),
  ).not.toContain("none");
  const accessibility = await new AxeBuilder({ page })
    .include(".templateGallery")
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await testInfo.attach("template-gallery", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("gallery shortcuts, search, prompts and cancellation keep the old note untouched", async ({
  page,
}) => {
  await openLibrary(page);
  await createSheet(page, "Keep these words.");
  const previous = page.url();
  await page.keyboard.press("Alt+Shift+n");
  const dialog = page.getByRole("dialog", {
    name: "New from template",
    exact: true,
  });
  await expect(
    dialog.getByRole("textbox", { name: "Title", exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole("textbox", { name: "Title", exact: true })
    .press("ControlOrMeta+f");
  await expect(
    dialog.getByRole("textbox", { name: "Search templates" }),
  ).toBeFocused();
  await dialog.getByRole("textbox", { name: "Search templates" }).fill("1:1");
  await dialog.locator(".templateCard").click();
  await dialog
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Weekly catch-up");
  await dialog
    .getByRole("textbox", { name: "Person", exact: true })
    .fill("বাংলা 🌿");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".cm-content")).toBeFocused();
  expect(page.url()).toBe(previous);
  expect(await readCurrentSheet(page)).toBe("Keep these words.");
  await gallery(page);
  await dialog.getByRole("textbox", { name: "Search templates" }).fill("1:1");
  await dialog.locator(".templateCard").click();
  await dialog
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Weekly catch-up");
  await dialog
    .getByRole("textbox", { name: "Person", exact: true })
    .fill("বাংলা 🌿");
  await dialog.getByRole("button", { name: "Create ↵", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(previous);
  expect(await readCurrentSheet(page)).toContain("With: বাংলা 🌿");
});

test("Space templates are real editable Markdown files; external edits survive as conflict copies", async ({
  page,
}) => {
  await openLibrary(page);
  await createSheet(page);
  const dialog = await gallery(page);
  await dialog
    .getByRole("button", { name: "Edit template", exact: true })
    .click();
  const editor = dialog.getByRole("textbox", {
    name: "Template source",
    exact: true,
  });
  const source =
    '---\ntemplate:\n  name: Client kickoff\n  category: Work\n  destination: Clients\n  filename: "{{title|slug}}"\n---\n# {{title}}\n\n{{prompt:Client|Acme}}\n\n{{cursor}}';
  await editor.fill(source);
  await dialog
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    ".slate/templates/template-client-kickoff.md",
  );
  expect(
    await spaceFile(page, ".slate/templates/template-client-kickoff.md"),
  ).toBe(source);
  await dialog
    .getByRole("button", { name: "Edit template", exact: true })
    .click();
  await editor.fill(source + "\nLocal change.");
  await spaceFile(
    page,
    ".slate/templates/template-client-kickoff.md",
    source + "\nExternal change.",
  );
  await dialog
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "external edit was kept",
  );
  expect(
    await spaceFile(page, ".slate/templates/template-client-kickoff.md"),
  ).toBe(source + "\nExternal change.");
  await dialog
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Launch");
  await dialog
    .getByRole("textbox", { name: "Client", exact: true })
    .fill("Real client");
  await dialog.getByRole("button", { name: "Create ↵", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => decodeURIComponent(page.url()))
    .toContain("Clients/launch.md");
  expect(await readCurrentSheet(page)).toBe(
    "# Launch\n\nReal client\n\n\nLocal change.",
  );
});

test("malformed templates remain visible and can be repaired without replacing unrelated configuration", async ({
  page,
}) => {
  await openLibrary(page);
  await createSheet(page);
  await spaceFile(page, ".slate/templates/broken.md", "---\ntemplate: [");
  await spaceFile(page, ".slate/keep.json", '{"keep":true}');
  const dialog = await gallery(page);
  await dialog
    .getByRole("button", { name: "broken.md Invalid template", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "original file is unchanged",
  );
  await dialog
    .getByRole("button", { name: "Repair template", exact: true })
    .click();
  const source = "# {{title}}\n\n{{cursor}}Repaired.";
  await dialog
    .getByRole("textbox", { name: "Template source", exact: true })
    .fill(source);
  await dialog
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "Saved to .slate/templates/broken.md",
  );
  expect(await spaceFile(page, ".slate/templates/broken.md")).toBe(source);
  expect(await spaceFile(page, ".slate/keep.json")).toBe('{"keep":true}');
});

test("Folder tier writes the new template note into its selected destination", async ({
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
          "template-folder",
          { create: true },
        ),
    }),
  );
  await page.goto("./");
  await page.getByText("Open a folder", { exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const dialog = await gallery(page);
  await dialog
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Folder meeting");
  await dialog.getByLabel("Date", { exact: true }).fill("2026-11-17");
  await dialog
    .getByRole("combobox", { name: "Notebook", exact: true })
    .fill("Projects/Kickoff");
  await dialog.getByRole("button", { name: "Create ↵", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const source = await page.evaluate(async () => {
    const folder = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle("template-folder");
    const kickoff = await (
      await folder.getDirectoryHandle("Projects")
    ).getDirectoryHandle("Kickoff");
    return (
      await (
        await kickoff.getFileHandle("2026-11-17-folder-meeting.md")
      ).getFile()
    ).text();
  });
  expect(source).toContain("## Agenda");
  expect(source).not.toMatch(/template:|\{\{/);
});

test("selection and manual clipboard values survive unavailable clipboard access and invalid routes", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Selected source.");
  await spaceFile(
    page,
    ".slate/templates/variables.md",
    '---\ntemplate:\n  name: Variables\n  destination: Captured\n  filename: "{{title|slug}}"\n---\n{{selection}}\n{{clipboard}}\n{{unknown}}',
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    }),
  );
  await editor.press("ControlOrMeta+a");
  await page.keyboard.press("Alt+Shift+n");
  const dialog = page.getByRole("dialog", {
    name: "New from template",
    exact: true,
  });
  await expect(dialog.getByText("Reading Space templates…")).toHaveCount(0);
  await dialog
    .locator(".templateMyRows")
    .getByRole("button", { name: "Variables", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Capture");
  await dialog
    .getByRole("button", { name: "Read clipboard", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Paste its text into the Clipboard field",
  );
  await dialog
    .getByRole("textbox", { name: "Clipboard", exact: true })
    .fill("Manual clipboard.");
  await dialog
    .getByRole("combobox", { name: "Notebook", exact: true })
    .fill("../outside");
  await dialog.getByRole("button", { name: "Create ↵", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Capture");
  await dialog
    .getByRole("combobox", { name: "Notebook", exact: true })
    .fill("Captured");
  await dialog.getByRole("button", { name: "Create ↵", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/sheet\/Captured%2Fcapture\.md$/);
  expect(await readCurrentSheet(page)).toBe(
    "Selected source.\nManual clipboard.\n{{unknown}}",
  );
});
