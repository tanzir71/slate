import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import {
  createSheet,
  openLibrary,
  readCurrentSheet,
  replaceEditorText,
} from "./helpers";
import golden from "../packages/core/test/fixtures/blocks.json" with { type: "json" };

const menu = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "Insert block", exact: true });
const table = golden.find((fixture) => fixture.id === "table")!.text;

async function savedText(page: import("@playwright/test").Page, text: string) {
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText(
    "Saved",
  );
  expect(await readCurrentSheet(page)).toBe(text);
}

async function query(page: import("@playwright/test").Page, text: string) {
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();
  await replaceEditorText(page, text);
  await page.locator(".cm-content").press("ControlOrMeta+End");
}

test("four keystrokes insert a table, with source-preserving undo and reopen", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "slate.block-usage",
      JSON.stringify({ task: { count: 100_000, lastUsed: Date.now() } }),
    ),
  );
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  await editor.press("ControlOrMeta+A");
  await editor.press("Backspace");
  await editor.pressSequentially("/ta");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Table");
  await editor.press("Enter");
  await expect(menu(page)).toBeHidden();
  await savedText(page, table);
  await editor.press("ControlOrMeta+z");
  await savedText(page, "/ta");
  await page.reload();
  await expect(page.locator(".cm-content")).toBeVisible();
  await savedText(page, "/ta");
});

test("keyboard navigation previews real Markdown and Escape keeps typed text", async ({
  page,
  isMobile,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  await query(page, "/ta");
  await expect(menu(page)).toBeVisible();
  await editor.press("ArrowDown");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Table of contents");
  await editor.press("ArrowUp");
  await editor.press("Tab");
  const preview = menu(page).getByRole("region", { name: "Block preview" });
  await expect(preview).toBeFocused();
  await expect(preview.getByRole("columnheader")).toHaveCount(3);
  await expect(preview.getByRole("cell")).toHaveCount(6);
  const bounds = await menu(page).boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width - 16);
  if (isMobile) await expect(menu(page).getByRole("listbox")).toBeHidden();
  await page.keyboard.press("Tab");
  await expect(editor).toBeFocused();
  const footer = await menu(page).locator(":scope > footer").boundingBox();
  const results = await menu(page).getByRole("listbox").boundingBox();
  expect(results!.y + results!.height).toBeLessThanOrEqual(footer!.y + 1);
  const selected = menu(page).getByRole("option", { selected: true });
  const first = await selected.getAttribute("id");
  await editor.press("ArrowUp");
  await expect(selected).not.toHaveAttribute("id", first!);
  const last = await selected.boundingBox();
  expect(last!.y + last!.height).toBeLessThanOrEqual(footer!.y + 1);
  await editor.press("ArrowDown");
  await expect(selected).toHaveAttribute("id", first!);
  const violations = (
    await new AxeBuilder({ page }).include(".slateBlockMenu").analyze()
  ).violations;
  expect(violations).toEqual([]);
  await editor.press("Escape");
  await expect(menu(page)).toBeHidden();
  await savedText(page, "/ta");
});

test("code language selection cancels without editing and inserts with one undo", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  await query(page, "/code");
  await editor.press("Enter");
  const picker = page.getByRole("dialog", {
    name: "Code language",
    exact: true,
  });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toBeFocused();
  await savedText(page, "/code");
  await editor.press("End");
  await editor.press("x");
  await editor.press("Backspace");
  await editor.press("Enter");
  await picker
    .getByRole("combobox", { name: "Code language", exact: true })
    .fill("rust");
  await picker
    .getByRole("button", { name: "Insert code block", exact: true })
    .click();
  await savedText(page, "```rust\n\n```");
  await editor.press("ControlOrMeta+z");
  await savedText(page, "/code");
});

test("image insertion saves exact asset bytes and a relative Markdown reference", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  await query(page, "/image");
  await editor.press("Enter");
  const picker = page.getByRole("dialog", {
    name: "Insert image",
    exact: true,
  });
  await picker.getByLabel("Image file", { exact: true }).setInputFiles({
    name: "Diagram.png",
    mimeType: "image/png",
    buffer: Buffer.from([137, 80, 78, 71, 10]),
  });
  await expect(picker).toBeHidden();
  await savedText(page, "![Diagram](assets/diagram.png)");
  const bytes = await page.evaluate(async () => {
    const id = decodeURIComponent(location.hash.split("/")[2]!);
    const root = await navigator.storage.getDirectory();
    const space = await (
      await root.getDirectoryHandle("spaces")
    ).getDirectoryHandle(id);
    const file = await (
      await (
        await space.getDirectoryHandle("assets")
      ).getFileHandle("diagram.png")
    ).getFile();
    return [...new Uint8Array(await file.arrayBuffer())];
  });
  expect(bytes).toEqual([137, 80, 78, 71, 10]);
  await editor.press("ControlOrMeta+z");
  await savedText(page, "/image");
});

test("literal slash contexts and front-matter boundaries preserve source", async ({ page }) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  for (const source of [
    "https://example.com/table",
    "` /table`",
    "```md\n/table",
    "---\ntitle: /table",
  ]) {
    await replaceEditorText(page, source);
    await editor.press("ControlOrMeta+End");
    await expect(menu(page)).toBeHidden();
    await savedText(page, source);
  }
  await query(page, " /yaml");
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("option")).toHaveCount(0);
  await savedText(page, " /yaml");
  await query(page, "/yaml");
  await expect(
    menu(page).getByRole("option", { selected: true }),
  ).toContainText("Front-matter");
  await editor.press("Enter");
  await savedText(
    page,
    golden.find((fixture) => fixture.id === "frontmatter")!.text,
  );
});
