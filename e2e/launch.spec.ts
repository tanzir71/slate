import { expect, test } from "./fixtures";
import { openLibrary } from "./helpers";

test("Today uses the local calendar date and reopens existing words unchanged", async ({ createContext, baseURL }) => {
  const context = await createContext({ timezoneId: "Asia/Dhaka", ...(baseURL ? { baseURL } : {}) });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date("2026-11-17T21:30:00Z"));
  await openLibrary(page);
  await page.goto("./?action=today");
  const dialog = page.getByRole("dialog", { name: "Open in Slate" });
  await expect(dialog).toBeVisible();
  await expect(page.locator(".browserSheetRow")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".headerBreadcrumb")).toHaveText("Daily/2026-11-18.md");
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("# Today\n\nWords I already wrote.");
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText("Saved");
  const original = await editor.innerText();
  await page.goto("./?action=today");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".headerBreadcrumb")).toHaveText("Daily/2026-11-18.md");
  await expect.poll(() => editor.innerText()).toBe(original);
  await expect(page.locator(".browserSheetRow")).toHaveCount(1);
});

test("Capture asks before appending and keeps the supplied words", async ({ page }) => {
  await openLibrary(page);
  await page.goto("./?action=capture&text=Words%20from%20my%20share");
  const dialog = page.getByRole("dialog", { name: "Open in Slate" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: /Capture.*Words from/ })).toBeHidden();
  await page.getByRole("button", { name: "Save to Inbox", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText("Words from my share");
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("Words from my share");
});

test("a New sheet shortcut can be cancelled without creating a file", async ({ page }) => {
  await openLibrary(page);
  await page.goto("./?action=new");
  await expect(page.getByRole("dialog", { name: "Open in Slate" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".browserSheetRow")).toHaveCount(0);
  await expect(page).not.toHaveURL(/action=new/);
});

test("opening a Markdown file asks before import and preserves its bytes", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Installed-app file handlers are a Chromium capability.");
  await page.addInitScript(() => {
    Object.defineProperty(window, "launchQueue", { configurable: true, value: {
      setConsumer(consumer: (launch: { files: { getFile(): Promise<File> }[] }) => void) {
        consumer({ files: [{ getFile: async () => new File(["# Opened\r\n\r\nMy file.\r\n"], "opened.md", { type: "text/markdown" }) }] });
      }
    } });
  });
  await openLibrary(page);
  await expect(page.getByRole("heading", { name: "Import opened Markdown files?" })).toBeVisible();
  await page.getByRole("dialog", { name: "Open in Slate" }).getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("button", { name: /Opened.*My file/ })).toBeVisible();
});
