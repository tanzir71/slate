import { expect, test } from "./fixtures";
import { createSheet, openLibrary } from "./helpers";
import { slateCommands } from "../packages/core/src/commands";
import { AxeBuilder } from "@axe-core/playwright";

const modifier = process.platform === "darwin" ? "Meta" : "Control";

test("every default web formatting binding reaches the editor and undoes in one step", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openLibrary(page);
  const editor = await createSheet(page, "words");
  const expected: Record<string, string> = {
    bold: "**words**",
    italic: "*words*",
    strike: "~~words~~",
    highlight: "==words==",
    code: "`words`",
    link: "[words](url)",
    paragraph: "words",
    heading1: "# words",
    heading2: "## words",
    heading3: "### words",
    heading4: "#### words",
    heading5: "##### words",
    heading6: "###### words",
    ordered: "1. words",
    bullet: "- words",
    task: "- [ ] words",
    quote: "> words",
    codeblock: "```\nwords\n```",
    toggleTask: "- [x] words",
  };
  for (const command of slateCommands.filter(
    (entry) => entry.group === "Format" && entry.shortcut,
  )) {
    const id = command.id.slice("format.".length);
    const initial =
      id === "toggleTask"
        ? "- [ ] words"
        : id === "paragraph"
          ? "# words"
          : "words";
    await editor.focus();
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.insertText(initial);
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press(command.shortcut!.replace("Mod", modifier));
    await expect(editor, command.id).toHaveText(expected[id]!, {
      useInnerText: true,
    });
    await page.keyboard.press(`${modifier}+z`);
    await expect(editor, `${command.id} undo`).toHaveText(initial);
  }
});

test("registry labels, shortcut search, palette formatting and focus restoration stay consistent", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "words");
  await page.keyboard.press(`${modifier}+a`);
  await page
    .getByRole("button", { name: "Keyboard shortcuts", exact: true })
    .click();
  const sheet = page.getByRole("dialog", {
    name: "Keyboard shortcuts",
    exact: true,
  });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".shortcutRow")).toHaveCount(slateCommands.length);
  const a11y = await new AxeBuilder({ page })
    .include(".commandDialog")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await expect(
    sheet
      .locator(".shortcutRow")
      .filter({ hasText: "New sheet" })
      .locator("kbd"),
  ).toContainText(process.platform === "darwin" ? "⌥ N" : "Alt N");
  await sheet.getByRole("textbox", { name: "Search shortcuts" }).fill("bold");
  await expect(sheet.locator(".shortcutRow")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Keyboard shortcuts", exact: true }),
  ).toBeFocused();
  await page.keyboard.press(`${modifier}+/`);
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  // Opening the palette outside the editor preserves its selection for formatting.
  await page.keyboard.press(`${modifier}+k`);
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("textbox", { name: "Search commands" }).fill("bold");
  await palette.getByRole("button", { name: /Bold/ }).click();
  await expect(editor).toHaveText("**words**");
  await expect(editor).toBeFocused();
  await page.keyboard.press(`${modifier}+z`);
  await expect(editor).toHaveText("words");
});

test("Space keymaps update editor bindings and labels, with complete fallback on conflicts", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "words");
  async function writeMap(bindings: Record<string, string | null>) {
    await page.evaluate(async (bindings) => {
      const id = decodeURIComponent(location.hash.split("/")[2]!);
      const root = await navigator.storage.getDirectory();
      const space = await (
        await root.getDirectoryHandle("spaces")
      ).getDirectoryHandle(id);
      const config = await space.getDirectoryHandle(".slate", { create: true });
      const writer = await (
        await config.getFileHandle("keymap.json", { create: true })
      ).createWritable();
      await writer.write(JSON.stringify({ version: 1, bindings }));
      await writer.close();
      window.dispatchEvent(new Event("focus"));
    }, bindings);
  }
  await writeMap({ "format.bold": "Mod+Shift+b", "sheet.new": "Alt+m" });
  await expect(
    page.getByRole("button", { name: "New Sheet", exact: true }).first(),
  ).toHaveAttribute("title", "New sheet (Alt M)");
  await editor.focus();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press(`${modifier}+Shift+b`);
  await expect(editor).toHaveText("**words**");
  await page.keyboard.press(`${modifier}+z`);
  await expect(editor).toHaveText("words");
  await page
    .getByRole("button", { name: "Keyboard shortcuts", exact: true })
    .click();
  const row = page.locator(".shortcutRow").filter({ hasText: /^Bold/ });
  await expect(row.locator("kbd")).toContainText("⇧ B");
  await page.keyboard.press("Escape");
  await writeMap({ "format.bold": "Mod+i", "sheet.new": "Alt+m" });
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Default shortcuts are active." }),
  ).toContainText("conflicts with Italic");
  await expect(
    page.getByRole("button", { name: "New Sheet", exact: true }).first(),
  ).toHaveAttribute("title", "New sheet (Alt N)");
  await editor.focus();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press(`${modifier}+b`);
  await expect(editor).toHaveText("**words**");
});
