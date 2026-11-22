import { expect, test } from "./fixtures";
import { createSheet, openLibrary, workspaceAction } from "./helpers";
import { editorSource } from "./editorSource";
import AxeBuilder from "@axe-core/playwright";

const modifier = process.platform === "darwin" ? "Meta" : "Control";
test("customize checks conflicts before saving and rebinds real editor commands across reload", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "words");
  const shortcutsInvoker = await workspaceAction(page, "Keyboard shortcuts");
  const sheet = page.getByRole("dialog", {
    name: "Keyboard shortcuts",
    exact: true,
  });
  await sheet.getByRole("button", { name: "macOS", exact: true }).click();
  await expect(
    sheet.locator(".shortcutRow").filter({ hasText: /^Bold/ }).locator("kbd"),
  ).toHaveText("⌘ B");
  await sheet.getByRole("button", { name: "Customize", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Customize shortcuts",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Save shortcuts", exact: true }),
  ).toBeInViewport();
  await dialog
    .getByRole("textbox", { name: "Shortcut for Bold", exact: true })
    .fill("Mod+i");
  await expect(dialog.getByRole("alert")).toContainText("conflicts");
  await expect(
    dialog.getByRole("button", { name: "Save shortcuts", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("textbox", { name: "Shortcut for New sheet", exact: true })
    .fill("Mod+n");
  await expect(dialog.getByRole("alert")).toContainText(
    "reserved by the browser",
  );
  await dialog
    .getByRole("button", { name: "Restore New sheet", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "Shortcut for Bold", exact: true })
    .fill("Mod+j");
  await dialog
    .getByRole("button", { name: "Save shortcuts", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(sheet).toBeVisible();
  await expect(
    sheet.locator(".shortcutRow").filter({ hasText: /^Bold/ }).locator("kbd"),
  ).toContainText("J");
  await page.keyboard.press("Escape");
  await expect(shortcutsInvoker).toBeFocused();
  await editor.focus();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press(`${modifier}+j`);
  await expect.poll(() => editorSource(editor)).toBe("**words**");
  await page.keyboard.press(`${modifier}+z`);
  await expect.poll(() => editorSource(editor)).toBe("words");
  await expect(
    page.getByRole("status", { name: "" }).filter({ hasText: /^Saved$/ }),
  ).toBeVisible();
  await page.reload();
  await expect(editor).toBeVisible();
  await editor.focus();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press(`${modifier}+j`);
  await expect.poll(() => editorSource(editor)).toBe("**words**");
  await page.keyboard.press(`${modifier}+z`);
  await expect.poll(() => editorSource(editor)).toBe("words");
});

test("unbinding and restoring defaults update real editor bindings", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "words");
  await workspaceAction(page, "Keyboard shortcuts");
  const sheet = page.getByRole("dialog", {
    name: "Keyboard shortcuts",
    exact: true,
  });
  const dialog = page.getByRole("dialog", {
    name: "Customize shortcuts",
    exact: true,
  });
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Unbind Bold", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Save shortcuts", exact: true })
    .click();
  // A pending save must finish before reading the underlying shortcut sheet.
  await expect(dialog).toBeHidden();
  await expect(sheet).toBeVisible();
  await expect(
    sheet.locator(".shortcutRow").filter({ hasText: /^Bold/ }).locator("kbd"),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await editor.focus();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press(`${modifier}+b`);
  await expect.poll(() => editorSource(editor)).toBe("words");
  await workspaceAction(page, "Keyboard shortcuts");
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Restore all defaults", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Save shortcuts", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(
    sheet.locator(".shortcutRow").filter({ hasText: /^Bold/ }).locator("kbd"),
  ).toContainText("B");
  await page.keyboard.press("Escape");
  await editor.focus();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press(`${modifier}+b`);
  await expect.poll(() => editorSource(editor)).toBe("**words**");
  await page.keyboard.press(`${modifier}+z`);
  await expect.poll(() => editorSource(editor)).toBe("words");
});

test("a keymap changed outside the open editor keeps disk bytes and the reviewed proposal", async ({
  page,
}) => {
  await openLibrary(page);
  await createSheet(page, "words");
  await workspaceAction(page, "Keyboard shortcuts");
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Customize shortcuts",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Shortcut for Bold", exact: true })
    .fill("Mod+j");
  const external =
    '\ufeff{"version":1,"bindings":{"format.bold":"Alt+b"},"keep":"external"}\r\n';
  await page.evaluate(async (source) => {
    const id = decodeURIComponent(location.hash.split("/")[2]!);
    const root = await navigator.storage.getDirectory();
    const space = await (
      await root.getDirectoryHandle("spaces")
    ).getDirectoryHandle(id);
    const config = await space.getDirectoryHandle(".slate", { create: true });
    const writer = await (
      await config.getFileHandle("keymap.json", { create: true })
    ).createWritable();
    await writer.write(source);
    await writer.close();
  }, external);
  await dialog
    .getByRole("button", { name: "Save shortcuts", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "proposal is preserved",
  );
  const physical = await page.evaluate(async () => {
    const id = decodeURIComponent(location.hash.split("/")[2]!);
    const root = await navigator.storage.getDirectory();
    const config = await (
      await (await root.getDirectoryHandle("spaces")).getDirectoryHandle(id)
    ).getDirectoryHandle(".slate");
    const rows: Record<string, number[]> = {};
    for await (const [name, handle] of config.entries())
      if (handle.kind === "file" && name.startsWith("keymap"))
        rows[name] = [
          ...new Uint8Array(
            await (
              await (handle as FileSystemFileHandle).getFile()
            ).arrayBuffer(),
          ),
        ];
    return rows;
  });
  expect(physical["keymap.json"]).toEqual([
    ...new TextEncoder().encode(external),
  ]);
  const copy = Object.entries(physical).find(([name]) =>
    name.includes("conflicted copy"),
  );
  expect(copy).toBeDefined();
  expect(
    JSON.parse(new TextDecoder().decode(new Uint8Array(copy![1]))).bindings[
      "format.bold"
    ],
  ).toBe("Mod+j");
  expect(
    (await new AxeBuilder({ page }).include(".keymapEditor").analyze())
      .violations,
  ).toEqual([]);
});
