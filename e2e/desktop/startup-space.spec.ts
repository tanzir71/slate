import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { nativeFixture } from "./nativeFixture";
import { replaceEditorText } from "../helpers";

const folder = { id: "12345678-1234-4321-9876-123456789abc", name: "Remembered notes", path: "C:\\Remembered notes" };
const rootSource = "\ufeffRoot original.\r\n", folderSource = "\ufeffRemembered folder words.\r\n";
async function prepare(page: Page, selected = false, disconnected = false) {
  await nativeFixture(page, { "same.md": rootSource });
  await page.addInitScript(({ folder, source, selected, disconnected }) => {
    localStorage.setItem("native-spaces", JSON.stringify([{ id: "native-default", name: "Slate", path: null }, folder]));
    localStorage.setItem("native-picked-space", JSON.stringify(folder));
    if (localStorage.getItem("native-startup-seeded")) return;
    localStorage.setItem("native-startup-seeded", "true");
    localStorage.setItem("native-file:folder:" + folder.id + ":same.md", JSON.stringify(Array.from(new TextEncoder().encode(source))));
    if (selected) localStorage.setItem("native-last-space", folder.id);
    if (disconnected) localStorage.setItem("native-selection-disconnected", folder.id);
  }, { folder, source: folderSource, selected, disconnected });
}
const disk = (page: Page, scope: string) => page.evaluate(scope => {
  const bytes = JSON.parse(localStorage.getItem("native-file:" + scope + ":same.md") ?? "null") as number[] | null;
  return bytes === null ? null : new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(bytes));
}, scope);
const saved = (page: Page) => page.evaluate(() => localStorage.getItem("native-last-space"));
async function picker(page: Page) {
  await page.locator(".spaceSwitcher").click();
  return page.getByRole("dialog", { name: "Spaces", exact: true });
}

test("the selected folder and its exact saved words reopen after renderer reload", async ({ page }) => {
  await prepare(page); await page.goto("./");
  await expect(page.locator(".cm-content")).toContainText("Root original.");
  const dialog = await picker(page); await dialog.getByRole("button").filter({ hasText: folder.path }).click();
  await expect(page.locator(".cm-content")).toContainText("Remembered folder words.");
  await replaceEditorText(page, "Saved selected words.");
  await expect.poll(() => disk(page, "folder:" + folder.id)).toBe("Saved selected words.");
  await page.reload(); await expect(page.locator(".cm-content")).toHaveText("Saved selected words.");
  await expect(page.locator(".spaceSwitcher")).toContainText(folder.name);
  expect(await saved(page)).toBe(folder.id); expect(await disk(page, "space")).toBe(rootSource);
});

test("cold startup reads the remembered folder before any unrelated default notes", async ({ page }) => {
  await prepare(page, true); await page.goto("./");
  await expect(page.locator(".cm-content")).toContainText("Remembered folder words.");
  const reads = await page.evaluate(() => (Reflect.get(window, "__NATIVE_FIXTURE__") as { workspaceReads(): { scope: string; spaceId: string }[] }).workspaceReads());
  expect(reads.filter(read => read.scope === "space").every(read => read.spaceId === folder.id)).toBe(true);
  expect(await disk(page, "space")).toBe(rootSource); expect(await disk(page, "folder:" + folder.id)).toBe(folderSource);
});

test("a disconnected saved folder remains recoverable without silently opening default notes", async ({ page }) => {
  await prepare(page, true, true); await page.goto("./");
  await expect(page.getByRole("alert")).toContainText("disconnected"); await expect(page.locator(".cm-content")).toHaveCount(0);
  expect(await saved(page)).toBe(folder.id);
  await page.getByRole("button", { name: "Try again", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("disconnected");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: "test-results/native-startup-disconnected.png" });
  await page.getByRole("button", { name: "Choose a Space", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Spaces", exact: true });
  await expect(dialog.locator('[aria-current="true"]')).toHaveCount(0);
  await dialog.getByRole("button").filter({ hasText: "On this device" }).click();
  await expect(page.locator(".cm-content")).toContainText("Root original.");
  expect(await saved(page)).toBe("native-default"); expect(await disk(page, "folder:" + folder.id)).toBe(folderSource);
});

test("a failed selection save retains the current draft and choice until a successful retry", async ({ page }) => {
  await prepare(page); await page.goto("./"); await expect(page.locator(".cm-content")).toBeVisible();
  await replaceEditorText(page, "Pending root words.");
  await page.evaluate(() => localStorage.setItem("native-fail-remember", "true"));
  const dialog = await picker(page); await dialog.getByRole("button").filter({ hasText: folder.path }).click();
  await expect(dialog.getByRole("alert")).toContainText("selection could not be saved");
  await expect(page.locator(".cm-content")).toHaveText("Pending root words.");
  expect(await saved(page)).toBe("native-default"); expect(await disk(page, "folder:" + folder.id)).toBe(folderSource);
  await page.evaluate(() => localStorage.removeItem("native-fail-remember"));
  await dialog.getByRole("button").filter({ hasText: folder.path }).click();
  await expect(page.locator(".cm-content")).toContainText("Remembered folder words.");
  await page.reload(); await expect(page.locator(".cm-content")).toContainText("Remembered folder words.");
  expect(await saved(page)).toBe(folder.id); expect(await disk(page, "space")).toBe("Pending root words.");
});

test("explicit managed-Space recovery still works when the optional selection and catalog are invalid", async ({ page }) => {
  await prepare(page, true);
  await page.addInitScript(() => { localStorage.setItem("native-selection-invalid", "true"); localStorage.setItem("native-fail-catalog", "true"); });
  await page.goto("./"); await expect(page.getByRole("alert")).toContainText("selection is invalid");
  await page.getByRole("button", { name: "Choose a Space", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Spaces", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("Spaces list is invalid");
  await dialog.getByRole("button").filter({ hasText: "On this device" }).click();
  await expect(page.locator(".cm-content")).toContainText("Root original.");
  expect(await saved(page)).toBe("native-default"); expect(await disk(page, "folder:" + folder.id)).toBe(folderSource);
});

test("an OS file takes precedence over a disconnected remembered folder", async ({ page }) => {
  await prepare(page, true, true);
  await page.addInitScript(folder => {
    const target = { space: { ...folder, id: "abcdef12-1234-4321-9876-123456789abc", name: "OS file notes", path: "C:\\OS file notes" }, path: "opened.md" };
    localStorage.setItem("native-file:folder:" + target.space.id + ":" + target.path, JSON.stringify(Array.from(new TextEncoder().encode("OS file words."))));
    (Reflect.get(window, "__NATIVE_FIXTURE__") as { openFiles(files: typeof target[]): void }).openFiles([target]);
  }, folder);
  await page.goto("./"); await expect(page.locator(".cm-content")).toHaveText("OS file words.");
  await expect(page.locator(".spaceSwitcher")).toContainText("OS file notes");
  expect(await saved(page)).toBe("abcdef12-1234-4321-9876-123456789abc");
  expect(await disk(page, "space")).toBe(rootSource); expect(await disk(page, "folder:" + folder.id)).toBe(folderSource);
});
