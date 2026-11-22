import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { nativeFixture } from "./nativeFixture";

async function bytes(page: Page, path: string) {
  return page.evaluate((path) => JSON.parse(localStorage.getItem("native-file:space:" + path) ?? "null") as number[] | null, path);
}
async function external(page: Page, path: string, source: string | null) {
  await page.evaluate(({ path, source }) => {
    if (source === null) localStorage.removeItem("native-file:space:" + path);
    else localStorage.setItem("native-file:space:" + path, JSON.stringify(Array.from(new TextEncoder().encode(source))));
    const fixture = Reflect.get(window, "__NATIVE_FIXTURE__") as { emit(event: string, payload: unknown): void };
    fixture.emit("slate://workspace-changed", { scope: "space", error: null });
  }, { path, source });
}
async function action(page: Page, name: string) {
  await page.getByRole("button", { name: "Sheet actions", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}
async function opened(page: Page) {
  await expect(page.locator(".browserWorkspace")).toHaveAttribute("data-editor-ready", "true");
}

test("a native startup failure preserves files and retry opens the real note", async ({ page }) => {
  await nativeFixture(page, { "real.md": "Words already on disk" });
  await page.addInitScript(() => localStorage.setItem("native-fail-read", "true"));
  await page.goto("./");
  await expect(page.getByRole("alert")).toContainText("Access denied");
  expect(await page.locator(".cm-content").count()).toBe(0);
  expect(await bytes(page, "real.md")).toEqual(Array.from(new TextEncoder().encode("Words already on disk")));
  await page.evaluate(() => localStorage.removeItem("native-fail-read"));
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await opened(page);
  await expect(page.locator(".cm-content")).toHaveText("Words already on disk");
});

test("an empty managed Space after Skip stays empty until creating a real note, then reopens its exact bytes", async ({ page }) => {
  await nativeFixture(page, {});
  await page.goto("./");
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A fresh page awaits." })).toBeVisible();
  expect(await page.locator(".cm-content").count()).toBe(0);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("native-file:")))).toEqual([]);
  await page.keyboard.press("ControlOrMeta+n");
  await opened(page);
  await page.locator(".cm-content").fill("My real note বাংলা 🙂");
  const path = "Inbox/Untitled.md";
  await expect.poll(() => bytes(page, path)).toEqual(Array.from(new TextEncoder().encode("My real note বাংলা 🙂")));
  await page.reload();
  await opened(page);
  await expect(page.locator(".cm-content")).toHaveText("My real note বাংলা 🙂");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("external create, edit, rename and delete reach the real workspace within 500ms", async ({ page }) => {
  await nativeFixture(page, { "note.md": "Original" });
  await page.goto("./");
  await opened(page);
  await external(page, "note.md", "External revision");
  await expect(page.locator(".cm-content")).toHaveText("External revision", { timeout: 500 });
  await external(page, "second.md", "# Second\n\nFound on disk");
  await expect(page.locator(".browserSheetRow").filter({ hasText: "Second" })).toBeVisible({ timeout: 500 });
  await external(page, "renamed.md", "External revision");
  await external(page, "note.md", null);
  await expect(page.locator(".browserSheetRow").filter({ hasText: "renamed" })).toBeVisible({ timeout: 500 });
  await external(page, "second.md", null);
  await expect(page.locator(".browserSheetRow").filter({ hasText: "Second" })).toHaveCount(0, { timeout: 500 });
  await page.getByRole("textbox", { name: "Search sheets", exact: true }).fill("External");
  await expect(page.locator(".browserSheetRow")).toHaveCount(1);
  await expect(page.locator(".storageFooter")).not.toContainText("Search cache unavailable");
});

test("rename, move and trash preserve the native bytes across reload", async ({ page }) => {
  await nativeFixture(page, { "note.md": "\uFEFF# Words\r\n\r\nKept\r\n" });
  await page.goto("./");
  await opened(page);
  const original = await bytes(page, "note.md");
  await action(page, "Rename sheet");
  let dialog = page.getByRole("dialog", { name: "Rename sheet", exact: true });
  await dialog.getByLabel("File name").fill("renamed");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await bytes(page, "note.md")).toBeNull();
  expect(await bytes(page, "renamed.md")).toEqual(original);
  await action(page, "Move sheet");
  dialog = page.getByRole("dialog", { name: "Move sheet", exact: true });
  await dialog.getByLabel("Notebook path").fill("Book");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await bytes(page, "Book/renamed.md")).toEqual(original);
  await page.reload();
  await opened(page);
  await expect(page.locator(".cm-content")).toContainText("Words");
  expect(await bytes(page, "Book/renamed.md")).toEqual(original);
  await action(page, "Delete sheet");
  dialog = page.getByRole("dialog", { name: "Move this sheet to trash?", exact: true });
  await dialog.getByRole("button", { name: "Move to trash", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await bytes(page, "Book/renamed.md")).toBeNull();
  expect(await bytes(page, ".slate/trash/1/Book/renamed.md")).toEqual(original);
});

test("native close waits for save and keeps failed drafts open for retry", async ({ page }) => {
  await nativeFixture(page, { "note.md": "Original" });
  await page.goto("./");
  await opened(page);
  await page.evaluate(() => localStorage.setItem("native-fail-save", "true"));
  await page.locator(".cm-content").fill("Words retained on failure");
  const close = () => page.evaluate(() => {
    const fixture = Reflect.get(window, "__NATIVE_FIXTURE__") as { emit(event: string, payload: unknown): void };
    fixture.emit("tauri://close-requested", null);
  });
  await close();
  await expect(page.getByRole("alert")).toContainText("Disk is read-only");
  expect(await page.evaluate(() => localStorage.getItem("native-destroyed"))).toBeNull();
  await expect(page.locator(".cm-content")).toHaveText("Words retained on failure");
  expect(await bytes(page, "note.md")).toEqual(Array.from(new TextEncoder().encode("Original")));
  await page.evaluate(() => localStorage.removeItem("native-fail-save"));
  await close();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("native-destroyed"))).toBe("true");
  expect(await bytes(page, "note.md")).toEqual(Array.from(new TextEncoder().encode("Words retained on failure")));
});

test("the native Tidy worker reviews without writing, applies through disk IPC, and undoes once", async ({ page }) => {
  const dirty = "  #   Draft\n\n+ _One_\n+ __Two__\n";
  const clean = "# Draft\n\n- *One*\n- **Two**\n";
  await nativeFixture(page, { "note.md": dirty });
  await page.goto("./");
  await opened(page);
  await page.getByRole("button", { name: "Tidy review", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Tidy review", exact: true });
  await expect(panel.locator(".tidyApplyAll")).toBeEnabled();
  expect(await bytes(page, "note.md")).toEqual(Array.from(new TextEncoder().encode(dirty)));
  await panel.locator(".tidyApplyAll").click();
  await expect.poll(() => bytes(page, "note.md")).toEqual(Array.from(new TextEncoder().encode(clean)));
  await page.locator(".cm-content").press("ControlOrMeta+z");
  await expect.poll(() => bytes(page, "note.md")).toEqual(Array.from(new TextEncoder().encode(dirty)));
});

test("a failed index rebuild searches current files and recovers after cache access returns", async ({ page }) => {
  await nativeFixture(page, { "note.md": "Original words" });
  await page.goto("./");
  await opened(page);
  const cached = () => page.evaluate(() => (Reflect.get(window, "__NATIVE_FIXTURE__") as { indexBodies(): string[] }).indexBodies());
  await expect.poll(cached).toEqual(["Original words"]);
  await page.evaluate(() => localStorage.setItem("native-fail-index", "true"));
  await page.locator(".cm-content").fill("Unique current words");
  await expect.poll(() => bytes(page, "note.md")).toEqual(Array.from(new TextEncoder().encode("Unique current words")));
  await expect(page.locator(".storageFooter")).toContainText("Search cache unavailable");
  expect(await cached()).toEqual(["Original words"]);
  const search = page.getByRole("textbox", { name: "Search sheets", exact: true });
  await search.fill("Unique current words");
  await expect(page.locator(".browserSheetRow")).toHaveCount(1);
  await page.evaluate(() => localStorage.removeItem("native-fail-index"));
  await external(page, "note.md", "Recovered cache words");
  await expect(page.locator(".storageFooter")).not.toContainText("Search cache unavailable");
  await search.fill("Recovered cache words");
  await expect(page.locator(".browserSheetRow")).toHaveCount(1);
  expect(await cached()).toEqual(["Recovered cache words"]);
});
