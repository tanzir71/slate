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
