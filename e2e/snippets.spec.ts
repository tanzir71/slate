import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  createSheet,
  expectSavedSheet,
  openLibrary,
  replaceEditorText,
  workspaceAction,
} from "./helpers";
import { libraryFile, libraryPaths } from "./libraryFiles";

const settings = (page: Page) =>
  page.getByRole("dialog", { name: "Snippets", exact: true });
async function manage(page: Page) {
  await workspaceAction(page, "Manage snippets");
  await expect(settings(page)).toBeVisible();
  await expect(
    settings(page).getByRole("button", { name: "Add snippet", exact: true }),
  ).toBeEnabled();
  return settings(page);
}
async function closeSettings(page: Page) {
  await settings(page)
    .getByRole("button", { name: "Close Snippets", exact: true })
    .click();
}
async function replace(page: Page, source: string) {
  await replaceEditorText(page, source);
  await page.locator(".cm-content").press("ControlOrMeta+End");
}
async function writeSpace(
  page: Page,
  snippets: {
    trigger: string;
    body: string;
    enabled?: boolean;
    name?: string;
  }[],
  extras = {},
) {
  await libraryFile(
    page,
    ".slate/snippets.json",
    JSON.stringify({ version: 1, ...extras, snippets }),
  );
  const dialog = await manage(page);
  const spaceName = (
    await page
      .getByRole("navigation", { name: "Sheet location", exact: true })
      .getByTitle("Switch Space", { exact: true })
      .innerText()
  ).trim();
  await dialog.getByRole("checkbox").check();
  for (const entry of snippets) {
    const row = dialog.locator("tr").filter({
      has: page.getByRole("button", {
        name: `Edit ${entry.trigger} in ${spaceName}`,
        exact: true,
      }),
    });
    await expect(row).toContainText(
      entry.enabled === false
        ? "Disabled"
        : entry.body.replace(/\r?\n/g, "  ↵  "),
    );
  }
  await closeSettings(page);
}
async function globalSource(page: Page) {
  return page.evaluate(async () =>
    (
      await (
        await (
          await (
            await navigator.storage.getDirectory()
          ).getDirectoryHandle("global")
        ).getFileHandle("snippets.json")
      ).getFile()
    ).text(),
  );
}

async function globalBytes(page: Page): Promise<number[] | undefined> {
  return page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle("global");
      const file = await directory.getFileHandle("snippets.json");
      return Array.from(
        new Uint8Array(await (await file.getFile()).arrayBuffer()),
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError")
        return;
      throw error;
    }
  });
}

/** WebKit on macOS can retain origin-global OPFS across temporary persistent profiles. */
async function preserveGlobalFile(page: Page, action: () => Promise<void>) {
  const original = await globalBytes(page);
  try {
    await action();
  } finally {
    await page.evaluate(async (bytes) => {
      const root = await navigator.storage.getDirectory();
      if (bytes === undefined) {
        try {
          await (
            await root.getDirectoryHandle("global")
          ).removeEntry("snippets.json");
        } catch (error) {
          if (
            !(error instanceof DOMException) ||
            error.name !== "NotFoundError"
          )
            throw error;
        }
      } else {
        const directory = await root.getDirectoryHandle("global", {
          create: true,
        });
        const stream = await (
          await directory.getFileHandle("snippets.json", { create: true })
        ).createWritable();
        await stream.write(new Uint8Array(bytes));
        await stream.close();
      }
    }, original);
  }
  await expect(async () => {
    expect(await globalBytes(page)).toEqual(original);
  }).toPass({ timeout: 5000 });
}

test("normal forms save real definitions; nested Tab/Space expansion, one undo and offline reopen keep exact Markdown", async ({
  page,
  context,
  isMobile,
}) => {
  await page.addInitScript(() => {
    const NativeChannel = window.BroadcastChannel;
    window.BroadcastChannel = class extends NativeChannel {
      constructor(name: string) {
        if (name === "slate-snippets")
          throw new Error("Advisory messaging blocked");
        super(name);
      }
    };
  });
  await openLibrary(page);
  const editor = await createSheet(page, ";nested");
  const dialog = await manage(page);
  await expect(dialog.locator("tbody tr")).toHaveCount(3);
  if (isMobile) {
    const targets = await dialog
      .locator("button:visible")
      .evaluateAll((buttons) =>
        buttons.map((button) => ({
          name: button.getAttribute("aria-label") ?? button.textContent,
          width: button.getBoundingClientRect().width,
          height: button.getBoundingClientRect().height,
        })),
      );
    for (const target of targets) {
      expect(target.width, `${target.name} width`).toBeGreaterThanOrEqual(44);
      expect(target.height, `${target.name} height`).toBeGreaterThanOrEqual(44);
    }
  }
  expect(
    (
      await new AxeBuilder({ page })
        .include(".snippetSettings")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await dialog
    .getByRole("button", { name: "Add snippet", exact: true })
    .click();
  await dialog.getByLabel("Name", { exact: true }).fill("Nested greeting");
  await dialog.getByLabel("Trigger", { exact: true }).fill(";nested");
  await dialog
    .getByRole("textbox", { name: "Snippet body", exact: true })
    .fill("${1:hello ${2:world}} then ${3:bye}$0");
  await dialog
    .getByRole("combobox", { name: "Expand on", exact: true })
    .selectOption("both");
  await dialog
    .getByRole("button", { name: "Save snippets", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: /^Edit ;nested in / }),
  ).toBeVisible();
  await closeSettings(page);
  const bytes = await libraryFile(page, ".slate/snippets.json");
  expect(
    JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))).snippets[0],
  ).toMatchObject({ trigger: ";nested", expandOn: "both" });
  await editor.press("ControlOrMeta+End");
  await editor.press("Tab");
  await expectSavedSheet(page, "hello world then bye");
  await page.keyboard.insertText("Alice");
  await editor.press("Tab");
  await page.keyboard.insertText("Bob");
  await editor.press("Tab");
  await expectSavedSheet(page, "Alice then Bob");
  await editor.press("ControlOrMeta+z");
  await editor.press("ControlOrMeta+z");
  await editor.press("ControlOrMeta+z");
  await expectSavedSheet(page, ";nested");
  await editor.press("Space");
  await expectSavedSheet(page, "hello world then bye");
  await editor.press("ControlOrMeta+z");
  await expectSavedSheet(page, ";nested");
  await page.reload();
  await expect(editor).toBeVisible();
  await manage(page);
  await closeSettings(page);
  await editor.press("ControlOrMeta+End");
  await editor.press("Tab");
  await expectSavedSheet(page, "hello world then bye");
  await context.setOffline(true);
  await page.reload();
  await expect(editor).toBeVisible();
  await manage(page);
  await closeSettings(page);
  await replace(page, ";nested");
  await editor.press("Tab");
  await expectSavedSheet(page, "hello world then bye");
  await context.setOffline(false);
});

test("Mod semicolon picker previews without editing, expands literal prompt/clipboard values and preserves a cancelled selection", async ({
  page,
}) => {
  await openLibrary(page);
  const original = "# Title\n\nSelected";
  const editor = await createSheet(page, original);
  await writeSpace(page, [
    {
      trigger: ";prompt",
      name: "Prompted snippet",
      body: "${1:{{title|upper}}} {{selection}} {{prompt:Person|Sam}} {{clipboard}} $0",
    },
  ]);
  await editor.press("ControlOrMeta+End");
  await editor.press("Home");
  await editor.press("Shift+End");
  await editor.press("ControlOrMeta+;");
  const picker = page.getByRole("dialog", {
    name: "Insert snippet",
    exact: true,
  });
  await picker
    .getByRole("combobox", { name: "Search snippets", exact: true })
    .fill(";prompt");
  await page.keyboard.press("Tab");
  await expect(picker.getByLabel("Snippet source preview")).toContainText(
    "{{selection}}",
  );
  await expectSavedSheet(page, original);
  expect(
    (
      await new AxeBuilder({ page })
        .include('dialog[aria-label="Insert snippet"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await editor.press("ControlOrMeta+;");
  await picker
    .getByRole("combobox", { name: "Search snippets", exact: true })
    .fill(";prompt");
  await page.keyboard.press("Enter");
  const prompt = page.getByRole("dialog", {
    name: "Insert Prompted snippet",
    exact: true,
  });
  await prompt.getByLabel("Person", { exact: true }).fill("Ada");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => {
          throw new DOMException("Denied", "NotAllowedError");
        },
      },
    }),
  );
  await prompt
    .getByRole("button", { name: "Read clipboard", exact: true })
    .click();
  await expect(prompt.getByRole("alert")).toContainText("Paste its text below");
  await prompt
    .getByLabel("Clipboard text", { exact: true })
    .fill("${9:literal} {{date}}");
  await prompt.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectSavedSheet(page, original);
  await editor.press("ControlOrMeta+;");
  await picker
    .getByRole("combobox", { name: "Search snippets", exact: true })
    .fill(";prompt");
  await page.keyboard.press("Enter");
  await prompt.getByLabel("Person", { exact: true }).fill("Ada");
  await prompt
    .getByLabel("Clipboard text", { exact: true })
    .fill("${9:literal} {{date}}");
  await prompt
    .getByRole("button", { name: "Insert snippet", exact: true })
    .click();
  await expectSavedSheet(
    page,
    "# Title\n\nTITLE Selected Ada ${9:literal} {{date}} ",
  );
  await editor.press("Tab");
  await page.keyboard.insertText("end");
  await expectSavedSheet(
    page,
    "# Title\n\nTITLE Selected Ada ${9:literal} {{date}} end",
  );
  await editor.press("ControlOrMeta+z");
  await editor.press("ControlOrMeta+z");
  await expectSavedSheet(page, original);
});

test("global files work in another Space while local overrides and disabled entries stay local", async ({
  page,
}) => {
  await openLibrary(page);
  await preserveGlobalFile(page, async () => {
    const editor = await createSheet(page, ";scope");
    const firstSpace = new URL(page.url()).hash.split("/")[2];
    const dialog = await manage(page);
    await dialog
      .getByRole("button", { name: "Edit global JSON", exact: true })
      .click();
    const global = JSON.stringify({
      version: 1,
      extra: "keep global",
      snippets: [{ trigger: ";scope", body: "Global" }],
    });
    await dialog
      .getByRole("textbox", { name: "Snippet configuration", exact: true })
      .fill(global);
    await dialog
      .getByRole("button", { name: "Save snippets", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", {
        name: "Edit ;scope in All Spaces",
        exact: true,
      }),
    ).toBeVisible();
    await closeSettings(page);
    expect(await globalSource(page)).toBe(global);
    await writeSpace(page, [{ trigger: ";scope", body: "Local" }]);
    await editor.press("ControlOrMeta+End");
    await editor.press("Tab");
    await expectSavedSheet(page, "Local");
    const headerSwitch = page
      .getByRole("navigation", { name: "Sheet location", exact: true })
      .getByTitle("Switch Space", { exact: true });
    if (await headerSwitch.isVisible()) await headerSwitch.click();
    else {
      await page
        .getByRole("button", { name: "Show navigation", exact: true })
        .click();
      await page
        .getByRole("complementary", {
          name: "Workspace navigation",
          exact: true,
        })
        .getByTitle("Switch Space", { exact: true })
        .click();
    }
    await page.getByText("Keep notes in this browser", { exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      page.getByRole("complementary", { name: "Sheets", exact: true }),
    ).toBeVisible();
    await createSheet(page, ";scope");
    expect(new URL(page.url()).hash.split("/")[2]).not.toBe(firstSpace);
    await manage(page);
    await closeSettings(page);
    await editor.press("ControlOrMeta+End");
    await editor.press("Tab");
    await expectSavedSheet(page, "Global");
    await writeSpace(page, [{ trigger: ";scope", body: "", enabled: false }]);
    await replace(page, ";scope");
    await editor.press("Tab");
    await expectSavedSheet(page, ";scope");
    expect(await globalSource(page)).toBe(global);
  });
});

test("JSON conflicts keep external metadata and the proposal; invalid bytes remain protected", async ({
  page,
}) => {
  await openLibrary(page);
  await createSheet(page, "Keep these words");
  const original = JSON.stringify({
    version: 1,
    custom: "original",
    snippets: [{ trigger: ";x", body: "Original", extra: "keep" }],
  });
  await libraryFile(page, ".slate/snippets.json", original);
  const dialog = await manage(page);
  await expect(
    dialog.getByRole("button", { name: /^Edit ;x in / }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Edit Space JSON", exact: true })
    .click();
  const proposal = original.replace("Original", "Proposed");
  await dialog
    .getByRole("textbox", { name: "Snippet configuration", exact: true })
    .fill(proposal);
  const external = original
    .replace('"original"', '"external"')
    .replace("Original", "External");
  await libraryFile(page, ".slate/snippets.json", external);
  await dialog
    .getByRole("button", { name: "Save snippets", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Your proposal is preserved",
  );
  expect(
    new TextDecoder().decode(
      new Uint8Array(await libraryFile(page, ".slate/snippets.json")),
    ),
  ).toBe(external);
  const copy = (await libraryPaths(page, true)).find((path) =>
    path.startsWith(".slate/snippets (conflicted copy"),
  )!;
  expect(copy).toBeTruthy();
  expect(
    new TextDecoder().decode(new Uint8Array(await libraryFile(page, copy))),
  ).toBe(proposal);
  await dialog
    .getByRole("button", { name: "Review current file", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Snippet configuration", exact: true }),
  ).toHaveValue(external);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await closeSettings(page);
  await libraryFile(page, ".slate/snippets.json", [255, 254, 0]);
  await manage(page);
  await dialog
    .getByRole("button", { name: "Edit Space JSON", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Save snippets", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("textbox", { name: "Snippet configuration", exact: true }),
  ).toHaveAttribute("readonly", "");
  expect(await libraryFile(page, ".slate/snippets.json")).toEqual([
    255, 254, 0,
  ]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await closeSettings(page);
  await libraryFile(page, ".slate/snippets.json", "bad JSON");
  await manage(page);
  await dialog
    .getByRole("button", { name: "Edit Space JSON", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "Snippet configuration", exact: true })
    .fill(external);
  await dialog
    .getByRole("button", { name: "Save snippets", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: /^Edit ;x in / }),
  ).toBeVisible();
  await closeSettings(page);
  await expectSavedSheet(page, "Keep these words");
});

test("an open snippet prompt cannot replace a newer external document", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, ";wait");
  await writeSpace(page, [
    {
      trigger: ";wait",
      name: "Delayed snippet",
      body: "{{prompt:Name|Sam}}$0",
    },
  ]);
  await editor.press("ControlOrMeta+End");
  await editor.press("Tab");
  const prompt = page.getByRole("dialog", {
    name: "Insert Delayed snippet",
    exact: true,
  });
  await expect(prompt).toBeVisible();
  const path = decodeURIComponent(new URL(page.url()).hash.split("/")[4]!);
  await libraryFile(page, path, "New external writing");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(editor).toContainText("New external writing");
  await prompt
    .getByRole("button", { name: "Insert snippet", exact: true })
    .click();
  await expect(prompt.getByRole("alert")).toContainText("The sheet changed");
  await prompt.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectSavedSheet(page, "New external writing");
});

test("linked fields, table stops and visible completions keep their keyboard precedence", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, ";mirror");
  await writeSpace(page, [
    { trigger: ";mirror", body: "${1:Name} / $1 / ${2:Role}$0" },
    { trigger: ";single", body: "${1:Name} / ${2:Role}$0" },
  ]);
  await editor.press("ControlOrMeta+End");
  await editor.press("Tab");
  await page.keyboard.insertText("Ada");
  await editor.press("Tab");
  await page.keyboard.insertText("Engineer");
  await editor.press("Tab");
  await expectSavedSheet(page, "Ada / Ada / Engineer");
  await replace(page, ";tbl");
  await editor.press("Tab");
  await page.keyboard.insertText("First");
  await editor.press("Tab");
  await page.keyboard.insertText("Second");
  await editor.press("Tab");
  await expect(editor).toContainText("| First | Second | Column 3 |");
  await libraryFile(page, "Tagged.md", "#wo #work");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.locator(".browserSidebar .navLabel").filter({ hasText: /^work$/ }),
  ).toHaveCount(1);
  await replace(page, "#work\n\n;single");
  await editor.press("Tab");
  await page.keyboard.insertText("#wo");
  const completion = page.locator(".cm-slate-completions");
  await expect(
    completion
      .getByRole("option", { selected: true })
      .locator(".cm-completionLabel"),
  ).toHaveText("wo");
  await editor.press("ArrowDown");
  await expect(
    completion
      .getByRole("option", { selected: true })
      .locator(".cm-completionLabel"),
  ).toHaveText("work");
  await editor.press("Tab");
  await editor.press("Tab");
  await page.keyboard.insertText("Role filled");
  await editor.press("Tab");
  await expectSavedSheet(page, "#work\n\n#work / Role filled");
});

test("a read-only tab keeps its snippet draft through write-ownership takeover", async ({
  page,
  context,
}) => {
  // This story opens a second cold tab and transfers the single-writer lock twice.
  test.setTimeout(60_000);
  await openLibrary(page);
  const editor = await createSheet(page, ";own");
  const dialog = await manage(page);
  await dialog
    .getByRole("button", { name: "Add snippet", exact: true })
    .click();
  await dialog.getByLabel("Name", { exact: true }).fill("Ownership draft");
  await dialog.getByLabel("Trigger", { exact: true }).fill(";own");
  await dialog
    .getByRole("textbox", { name: "Snippet body", exact: true })
    .fill("Owned");
  const reader = await context.newPage();
  await reader.goto(page.url());
  await reader.getByRole("button", { name: "Use here", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Save snippets", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("textbox", { name: "Snippet body", exact: true }),
  ).toHaveValue("Owned");
  await dialog.getByRole("button", { name: "Use here", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Save snippets", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Save snippets", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: /^Edit ;own in / }),
  ).toBeVisible();
  await closeSettings(page);
  await editor.press("ControlOrMeta+End");
  await editor.press("Tab");
  await expectSavedSheet(page, "Owned");
  await reader.close();
});

test("Folder snippets use actual selected-directory configuration and leave code literal", async ({
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
        ).getDirectoryHandle("snippet-folder", { create: true });
        const config = await folder.getDirectoryHandle(".slate", {
          create: true,
        });
        const stream = await (
          await config.getFileHandle("snippets.json", { create: true })
        ).createWritable();
        await stream.write(
          JSON.stringify({
            version: 1,
            extra: "kept",
            snippets: [
              {
                trigger: ";folder",
                name: "Folder snippet",
                body: "${1:Folder name}$0",
              },
            ],
          }),
        );
        await stream.close();
        const note = await (
          await folder.getFileHandle("Note.md", { create: true })
        ).createWritable();
        await note.write(";folder");
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
  await manage(page);
  await closeSettings(page);
  await editor.press("ControlOrMeta+End");
  await editor.press("Tab");
  await page.keyboard.insertText("বাংলা 🙂");
  await editor.press("Tab");
  await expect(async () => {
    expect(
      await page.evaluate(async () =>
        (
          await (
            await (
              await (
                await navigator.storage.getDirectory()
              ).getDirectoryHandle("snippet-folder")
            ).getFileHandle("Note.md")
          ).getFile()
        ).text(),
      ),
    ).toBe("বাংলা 🙂");
  }).toPass({ timeout: 5000 });
  await replace(page, "```md\n;folder");
  await editor.press("Tab");
  await expect(editor).toContainText(";folder");
  expect(
    await page.evaluate(
      async () =>
        JSON.parse(
          await (
            await (
              await (
                await (
                  await navigator.storage.getDirectory()
                ).getDirectoryHandle("snippet-folder")
              ).getDirectoryHandle(".slate")
            ).getFileHandle("snippets.json")
          )
            .getFile()
            .then((file) => file.text()),
        ).extra,
    ),
  ).toBe("kept");
});

test("picker keyboard navigation reveals offscreen rows and keeps preview actions reachable", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start ");
  await writeSpace(
    page,
    Array.from({ length: 18 }, (_, index) => ({
      trigger: `;row${String(index + 1).padStart(2, "0")}`,
      name: `Row ${String(index + 1).padStart(2, "0")}`,
      body: `Value ${index + 1}$0`,
    })),
  );
  await editor.press("ControlOrMeta+End");
  await editor.press("ControlOrMeta+;");
  const picker = page.getByRole("dialog", {
    name: "Insert snippet",
    exact: true,
  });
  const search = picker.getByRole("combobox", {
    name: "Search snippets",
    exact: true,
  });
  await search.fill("Row ");
  for (let index = 0; index < 15; index++) await search.press("ArrowDown");
  const selected = picker.getByRole("option", { selected: true });
  await expect(selected).toContainText("Row 16");
  await expect(async () => {
    const row = await selected.boundingBox(),
      viewport = await picker.getByRole("listbox").boundingBox();
    expect(row).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(row!.y).toBeGreaterThanOrEqual(viewport!.y - 1);
    expect(row!.y + row!.height).toBeLessThanOrEqual(
      viewport!.y + viewport!.height + 1,
    );
  }).toPass();
  await search.press("Tab");
  await expect(
    picker.getByLabel("Snippet source preview", { exact: true }),
  ).toContainText("Value 16$0");
  const geometry = await picker.evaluate((element) => {
    const icons = [
      ...element.querySelectorAll<HTMLElement>(".snippetIcon"),
    ].map((icon) => ({
      width: icon.getBoundingClientRect().width,
      height: icon.getBoundingClientRect().height,
      mask: getComputedStyle(icon).maskImage,
    }));
    return {
      icons,
      right: element.getBoundingClientRect().right,
      bottom: element.querySelector("footer")!.getBoundingClientRect().bottom,
      screenWidth: innerWidth,
      screenHeight: innerHeight,
    };
  });
  expect(
    geometry.icons.every(
      (icon) => icon.width === 16 && icon.height === 16 && icon.mask !== "none",
    ),
  ).toBe(true);
  expect(geometry.right).toBeLessThanOrEqual(geometry.screenWidth);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.screenHeight);
  await search.press("Enter");
  await expectSavedSheet(page, "Start Value 16");
});
