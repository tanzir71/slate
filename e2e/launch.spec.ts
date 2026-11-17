import { expect, test } from "./fixtures";
import { openLibrary } from "./helpers";

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
