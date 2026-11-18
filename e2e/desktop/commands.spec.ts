import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.set(window, "__TAURI_INTERNALS__", {
      async invoke(command: string, args: Record<string, unknown>) {
        if (command !== "write_sheet") throw new Error(`Unexpected native command: ${command}`);
        localStorage.setItem(`native-test:${String(args.path)}`, String(args.content));
        return { status: "written", path: args.path };
      },
    });
  });
  await page.goto("./");
  await expect(page.locator(".cm-content")).toBeVisible();
});

test("desktop migration notice is dismissible and is shown only once", async ({ page }) => {
  const notice = page.locator(".shortcutMigrationNotice");
  await expect(notice).toContainText("Default shortcuts changed.");
  const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
  await expect(notice).toContainText(mac ? "Italic: ⌘ I. Inspector: ⌘ ⇧ I." : "Italic: Ctrl I. Inspector: Ctrl ⇧ I.");
  expect((await new AxeBuilder({ page }).include(".shortcutMigrationNotice").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await notice.getByRole("button", { name: "Dismiss shortcut notice", exact: true }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(notice).toHaveCount(0);
});

test("desktop wiki completion saves a canonical link and opens its target", async ({ page }) => {
  const editor = page.locator(".cm-content");
  await editor.fill("# Source\n\n");
  await editor.press("ControlOrMeta+End");
  await editor.pressSequentially("[[Product Vis");
  const option = page.locator(".cm-slate-completions").getByRole("option").filter({ hasText: "Product Vision" });
  await expect(option).toBeVisible();
  await expect(option).toContainText("product/strategy/product-vision.md");
  await editor.press("Tab");
  const expected = "# Source\n\n[[product/strategy/product-vision.md|Product Vision]]";
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("native-test:")).map((key) => localStorage.getItem(key)))).toContain(expected);
  await editor.press("ControlOrMeta+z");
  await expect(editor).toContainText("[[Product Vis");
  await editor.press("Escape");
  await editor.pressSequentially("ion");
  await expect(option).toBeVisible();
  await editor.press("Enter");
  await editor.press("ControlOrMeta+Home");
  await editor.locator(".cm-slate-wiki-link").click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".editorToolbar h1")).toHaveText("Product Vision");
});

test("desktop formatting, registry shortcuts and IPC saves agree", async ({ page }) => {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Inspector" })).toBeHidden();
  const editor = page.locator(".cm-content");
  await editor.fill("Words worth keeping.");
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("ControlOrMeta+Shift+End");
  await page.keyboard.press("ControlOrMeta+i");
  await expect(editor).toHaveText("*Words worth keeping.*");
  await expect(page.getByRole("complementary", { name: "Inspector" })).toBeHidden();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("native-test:")).map((key) => localStorage.getItem(key)))).toContain("*Words worth keeping.*");
  await page.keyboard.press("ControlOrMeta+Shift+I");
  await expect(page.getByRole("complementary", { name: "Inspector" })).toBeVisible();
  await page.getByRole("button", { name: "Close inspector", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Inspector" })).toBeHidden();
  await page.keyboard.press("ControlOrMeta+/");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog.locator(".shortcutProfile")).toContainText("Desktop");
  await expect(dialog.locator(".shortcutRow").filter({ hasText: "New sheet" }).locator("kbd")).toHaveText(/^(Ctrl|⌘) N$/);
  await expect(dialog.getByText("Export Space as .zip", { exact: true })).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page }).include(".commandDialog").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.keyboard.press("ControlOrMeta+n");
  await expect(page.locator(".editorToolbar h1")).toHaveText("Untitled Sheet");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("Words worth keeping.");
});

test("desktop palette executes formatting and appearance and preserves invoker focus", async ({ page }) => {
  const editor = page.locator(".cm-content");
  await editor.fill("My words.");
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("ControlOrMeta+Shift+End");
  await page.getByRole("button", { name: "Commands", exact: true }).click();
  let palette = page.getByRole("dialog", { name: "Command palette", exact: true });
  await palette.getByRole("textbox", { name: "Search commands" }).fill("Bold");
  await palette.getByRole("button", { name: /Bold/ }).click();
  await expect(editor).toHaveText("**My words.**");
  await page.getByRole("button", { name: "Commands", exact: true }).click();
  palette = page.getByRole("dialog", { name: "Command palette", exact: true });
  await palette.getByRole("textbox", { name: "Search commands" }).fill("Use Dark");
  await palette.getByRole("button", { name: "Use Dark appearance", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const shortcuts = page.getByRole("button", { name: "Keyboard shortcuts", exact: true });
  await shortcuts.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(shortcuts).toBeFocused();
});

test("desktop block insertion uses the language picker, atomic undo and IPC saves", async ({
  page,
}) => {
  const editor = page.locator(".cm-content");
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText("/code");
  await editor.press("Enter");
  const picker = page.getByRole("dialog", {
    name: "Code language",
    exact: true,
  });
  await expect(picker).toBeVisible();
  await picker
    .getByRole("combobox", { name: "Code language", exact: true })
    .fill("rust");
  expect(
    (await new AxeBuilder({ page }).include(".workspaceDialog").analyze())
      .violations,
  ).toEqual([]);
  await picker
    .getByRole("button", { name: "Insert code block", exact: true })
    .click();
  const saved = () =>
    page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith("native-test:"))
        .map((key) => localStorage.getItem(key)),
    );
  await expect.poll(saved).toContain("```rust\n\n```");
  await expect(editor).toBeFocused();
  await editor.press("ControlOrMeta+z");
  await expect.poll(saved).toContain("/code");
});
