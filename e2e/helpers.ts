import { expect, type Page } from "@playwright/test";

export async function openLibrary(page: Page) {
  await page.goto("./", { waitUntil: "domcontentloaded" });
  await page.getByText("Keep notes in this browser", { exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Sheets", exact: true })).toBeVisible({ timeout: 15_000 });
}

export async function createSheet(page: Page, text = "# My writing\n\nWords worth keeping.") {
  const previousURL = page.url();
  await page.getByRole("button", { name: "New Sheet", exact: true }).first().click();
  await expect(page).not.toHaveURL(previousURL);
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.click();
  await page.keyboard.insertText(text);
  await expect(page.getByRole("status", { name: "" }).filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 15_000 });
  return editor;
}

export async function replaceEditorText(page: Page, text: string) {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(text);
  // These recovery fixtures have a heading only on line one; reveal its source marker.
  await page.keyboard.press("ControlOrMeta+Home");
  await expect.poll(async () => (await editor.locator(".cm-line").allTextContents()).join("\n")).toBe(text);
}

export async function showSheets(page: Page) {
  await expect(page.locator(".workspaceHeader")).toBeVisible();
  if (!await page.getByRole("complementary", { name: "Sheets", exact: true }).isVisible()) await page.getByRole("button", { name: "Show sheets", exact: true }).click();
}

export async function workspaceAction(page: Page, name: string) {
  await expect(page.locator(".workspaceHeader")).toBeVisible();
  const direct = page.locator(".workspaceHeaderTools > button").filter({ has: page.locator("svg") }).and(page.getByRole("button", { name, exact: true }));
  if (await direct.isVisible()) { await direct.click(); return direct; }
  const menu = page.getByRole("button", { name: "Sheet actions", exact: true });
  if (!await page.locator(".sheetActionsMenu").evaluate((element) => element.hasAttribute("open"))) await menu.click();
  await page.locator(".sheetActionsItems").getByRole("button", { name, exact: true }).click();
  return menu;
}

export async function appearanceControl(page: Page) {
  await expect(page.locator(".workspaceHeader")).toBeVisible();
  const direct = page.locator(".workspaceHeaderTools > .appearanceControl select");
  if (await direct.isVisible()) return direct;
  const menu = page.getByRole("button", { name: "Sheet actions", exact: true });
  if (!await page.locator(".sheetActionsMenu").evaluate((element) => element.hasAttribute("open"))) await menu.click();
  return page.locator(".mobileAppearance").getByRole("combobox", { name: "Appearance", exact: true });
}

export async function chooseAppearance(page: Page, preference: "light" | "dark" | "system") {
  await (await appearanceControl(page)).selectOption(preference);
  if (await page.locator(".sheetActionsMenu[open]").count()) await page.getByRole("button", { name: "Sheet actions", exact: true }).click();
}

export async function readCurrentSheet(page: Page) {
  return page.evaluate(async () => {
    const parts = location.hash.split("/");
    const id = decodeURIComponent(parts[2]!);
    const path = decodeURIComponent(parts[4]!).split("/");
    const filename = path.pop()!;
    const root = await navigator.storage.getDirectory();
    let directory = await (await root.getDirectoryHandle("spaces")).getDirectoryHandle(id);
    for (const part of path) directory = await directory.getDirectoryHandle(part);
    return (await (await directory.getFileHandle(filename)).getFile()).text();
  });
}
