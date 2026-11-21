import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { nativeFixture } from "./nativeFixture";
import { replaceEditorText } from "../helpers";

const chosen = { id: "12345678-1234-4321-9876-123456789abc", name: "Chosen notes", path: "C:\\Chosen notes" };
async function prepare(page: Page) {
  await nativeFixture(page, { "same.md": "First Space words" });
  await page.addInitScript((folder) => {
    localStorage.setItem("native-spaces", JSON.stringify([{ id: "native-default", name: "Slate", path: null }, folder]));
    localStorage.setItem("native-picked-space", JSON.stringify(folder));
    if (!localStorage.getItem("native-folder-ready")) {
      localStorage.setItem("native-file:folder:" + folder.id + ":same.md", JSON.stringify(Array.from(new TextEncoder().encode("Second Space words"))));
      localStorage.setItem("native-folder-ready", "true");
    }
  }, chosen);
  await page.goto("./");
  await expect(page.locator(".cm-content")).toHaveText("First Space words");
}
async function spaces(page: Page) {
  await page.locator(".spaceSwitcher").click();
  const dialog = page.getByRole("dialog", { name: "Spaces", exact: true });
  await expect(dialog.getByRole("button", { name: "Open a folder", exact: true })).toBeEnabled();
  return dialog;
}
async function disk(page: Page, id: string) {
  return page.evaluate(id => JSON.parse(localStorage.getItem("native-file:" + (id === "native-default" ? "space:" : "folder:" + id + ":") + "same.md") ?? "null") as number[] | null, id);
}
test("native folder selection flushes the old draft and keeps saves, search and Inspector in the selected Space", async ({ page }) => {
  await prepare(page);
  await replaceEditorText(page, "First pending draft");
  let dialog = await spaces(page);
  await expect(dialog.getByText(chosen.path, { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: "test-results/native-spaces-picker.png" });
  await dialog.getByRole("button", { name: "Open a folder", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".cm-content")).toHaveText("Second Space words");
  expect(await disk(page, "native-default")).toEqual(Array.from(new TextEncoder().encode("First pending draft")));
  await replaceEditorText(page, "Second saved draft");
  await expect.poll(() => disk(page, chosen.id)).toEqual(Array.from(new TextEncoder().encode("Second saved draft")));
  const search = page.getByRole("textbox", { name: "Search sheets", exact: true });
  await search.fill("First pending"); await expect(page.locator(".browserSheetRow")).toHaveCount(0);
  await search.fill("Second saved"); await expect(page.locator(".browserSheetRow")).toHaveCount(1);
  await search.clear();
  await page.getByRole("button", { name: "Toggle inspector", exact: true }).click();
  await expect(page.getByText("C:\\Chosen notes\\same.md", { exact: true })).toBeVisible();
  dialog = await spaces(page);
  await dialog.getByRole("button").filter({ hasText: "On this device" }).click();
  await expect(page.locator(".cm-content")).toHaveText("First pending draft");
  dialog = await spaces(page);
  await dialog.getByRole("button").filter({ hasText: chosen.path }).click();
  await expect(page.locator(".cm-content")).toHaveText("Second saved draft");
});
test("a failed native folder switch retains the current editor and can be retried", async ({ page }) => {
  await prepare(page); const dialog = await spaces(page);
  await page.evaluate(() => localStorage.setItem("native-fail-read", "true"));
  await dialog.getByRole("button", { name: "Open a folder", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Access denied");
  await expect(page.locator(".cm-content")).toHaveText("First Space words");
  expect(await disk(page, chosen.id)).toEqual(Array.from(new TextEncoder().encode("Second Space words")));
  await page.evaluate(() => localStorage.removeItem("native-fail-read"));
  await dialog.getByRole("button", { name: "Open a folder", exact: true }).click();
  await expect(page.locator(".cm-content")).toHaveText("Second Space words");
});
test("cancelling the native folder picker keeps the Space and its bytes", async ({ page }) => {
  await prepare(page); const dialog = await spaces(page);
  await page.evaluate(() => localStorage.removeItem("native-picked-space"));
  await dialog.getByRole("button", { name: "Open a folder", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Open a folder", exact: true })).toBeEnabled();
  await expect(dialog).toBeVisible(); await expect(page.locator(".cm-content")).toHaveText("First Space words");
  expect(await disk(page, "native-default")).toEqual(Array.from(new TextEncoder().encode("First Space words")));
});
test("watcher events for a previous Space cannot refresh the current folder", async ({ page }) => {
  await prepare(page); const dialog = await spaces(page);
  await dialog.getByRole("button", { name: "Open a folder", exact: true }).click();
  await expect(page.locator(".cm-content")).toHaveText("Second Space words");
  await page.evaluate((folder) => {
    localStorage.setItem("native-file:folder:" + folder.id + ":same.md", JSON.stringify(Array.from(new TextEncoder().encode("External second words"))));
    const events = Reflect.get(window, "__NATIVE_FIXTURE__") as { emit(event: string, payload: unknown): void };
    events.emit("slate://workspace-changed", { scope: "space", spaceId: "native-default", error: "Other Space is disconnected" });
  }, chosen);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate((folder) => {
    const events = Reflect.get(window, "__NATIVE_FIXTURE__") as { emit(event: string, payload: unknown): void };
    events.emit("slate://workspace-changed", { scope: "space", spaceId: folder.id, error: null });
  }, chosen);
  await expect(page.locator(".cm-content")).toHaveText("External second words", { timeout: 500 });
});
