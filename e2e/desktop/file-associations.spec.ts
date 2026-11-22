import { expect, test, type Page } from "@playwright/test";
import { nativeFixture } from "./nativeFixture";
import { replaceEditorText } from "../helpers";

const space = { id: "12345678-1234-4321-9876-123456789abc", name: "Associated notes", path: "C:\\Associated notes" };
const target = { space, path: "Notebook/文 # 100%.MD" };
const original = "\ufeffCold file words.\r\n\r\nExact bytes.\r\n";
type Events = { openFiles(files: typeof target[]): void; launch(url: string): void; workspaceReads(): { command: string; spaceId: string; scope: string; path: string }[] };
async function prepare(page: Page, cold = false, requested = target) {
  await nativeFixture(page, { "draft.md": "Original main words." });
  await page.addInitScript(({ target, source, cold }) => {
    if (localStorage.getItem("native-os-file-seeded")) return;
    localStorage.setItem("native-os-file-seeded", "true");
    localStorage.setItem("native-file:folder:" + target.space.id + ":" + target.path, JSON.stringify(Array.from(new TextEncoder().encode(source))));
    if (cold) {
      localStorage.setItem("native-default-unavailable", "true");
      const events = Reflect.get(window, "__NATIVE_FIXTURE__") as Events; events.openFiles([target]);
    }
  }, { target: requested, source: original, cold });
  await page.goto("./");
}
const disk = (page: Page, scope: string, path: string) => page.evaluate(({ scope, path }) => {
  const bytes = JSON.parse(localStorage.getItem("native-file:" + scope + ":" + path) ?? "null") as number[] | null;
  return bytes === null ? null : new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(bytes));
}, { scope, path });
const finished = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem("native-launch-inbox") ?? "{}") as { current?: unknown }).current === null);
async function openFile(page: Page) { await page.evaluate(target => (Reflect.get(window, "__NATIVE_FIXTURE__") as Events).openFiles([target]), target); }

test("cold OS file opens its own Space in place without requiring the default library", async ({ page }) => {
  await prepare(page, true);
  await expect(page.locator(".cm-content")).toContainText("Cold file words.");
  await expect.poll(() => finished(page)).toBe(true);
  await expect(page.locator(".spaceSwitcher")).toContainText(space.name);
  expect(await disk(page, "folder:" + space.id, target.path)).toBe(original);
  const reads = await page.evaluate(() => (Reflect.get(window, "__NATIVE_FIXTURE__") as Events).workspaceReads());
  expect(reads.filter(read => read.scope === "space").every(read => read.spaceId === space.id)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("native-file:space:Notebook/文 # 100%.MD"))).toBeNull();
  await page.screenshot({ path: "test-results/native-associated-cold-file.png" });
});

test("a file-driven Space switch keeps failed current words until the original save succeeds", async ({ page }) => {
  await prepare(page); await expect(page.locator(".cm-content")).toHaveText("Original main words.");
  await page.evaluate(() => localStorage.setItem("native-fail-save", "true"));
  await replaceEditorText(page, "Pending main words."); await openFile(page);
  await expect(page.getByRole("dialog", { name: "Open Markdown file", exact: true }).getByRole("alert")).toContainText("read-only");
  await expect(page.locator(".cm-content")).toHaveText("Pending main words.");
  expect(await disk(page, "folder:" + space.id, target.path)).toBe(original);
  await page.screenshot({ path: "test-results/native-associated-failed-draft.png" });
  await page.evaluate(() => localStorage.removeItem("native-fail-save"));
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("Cold file words."); await expect.poll(() => finished(page)).toBe(true);
  expect(await disk(page, "space", "draft.md")).toBe("Pending main words.");
  expect(await disk(page, "folder:" + space.id, target.path)).toBe(original);
});

test("incoming files wait behind an edited URL confirmation and never replace its text", async ({ page }) => {
  await prepare(page); await expect(page.locator(".cm-content")).toBeVisible();
  await page.evaluate(() => (Reflect.get(window, "__NATIVE_FIXTURE__") as Events).launch("slate://new?title=Draft&text=Kept%20URI%20words"));
  await page.getByLabel("Title", { exact: true }).fill("Created"); await openFile(page);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Created");
  await expect(page.getByText("1 incoming request waiting.")).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Review next request", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("Cold file words."); await expect.poll(() => finished(page)).toBe(true);
  expect(await disk(page, "space", "Inbox/Created.md")).toBe("Kept URI words");
  expect(await disk(page, "folder:" + space.id, target.path)).toBe(original);
});

test("a lost completion reply survives renderer reload and finishes without beginning another open", async ({ page }) => {
  await prepare(page); await expect(page.locator(".cm-content")).toBeVisible();
  await page.evaluate(() => localStorage.setItem("native-fail-complete", "true")); await openFile(page);
  await expect(page.getByRole("alert")).toContainText("Finishing unavailable");
  expect(await page.evaluate(() => localStorage.getItem("native-associated-begins"))).toBe("1");
  expect(await disk(page, "folder:" + space.id, target.path)).toBe(original);
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Finish desktop request", exact: true })).toBeVisible();
  await expect(page.locator(".spaceSwitcher")).toContainText(space.name);
  await page.evaluate(() => localStorage.removeItem("native-fail-complete"));
  await page.getByRole("button", { name: "Finish request", exact: true }).click(); await expect.poll(() => finished(page)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("native-associated-begins"))).toBe("1");
  expect(await disk(page, "folder:" + space.id, target.path)).toBe(original);
});

test("an unavailable native file stays a cancellable error and does not create or copy a note", async ({ page }) => {
  await prepare(page); await expect(page.locator(".cm-content")).toBeVisible();
  await page.evaluate(() => localStorage.setItem("native-file-unavailable", "true")); await openFile(page);
  const dialog = page.getByRole("dialog", { name: "Open Markdown file", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("original file is unavailable");
  await expect(page.locator(".cm-content")).toHaveText("Original main words.");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click(); await expect.poll(() => finished(page)).toBe(true);
  expect(await disk(page, "space", "draft.md")).toBe("Original main words.");
  expect(await disk(page, "folder:" + space.id, target.path)).toBe(original);
});

test("an OS file can recover a failed default startup without creating default notes", async ({ page }) => {
  await nativeFixture(page, {});
  await page.addInitScript(({ target, source }) => {
    localStorage.setItem("native-default-unavailable", "true");
    localStorage.setItem("native-file:folder:" + target.space.id + ":" + target.path, JSON.stringify(Array.from(new TextEncoder().encode(source))));
  }, { target, source: original });
  await page.goto("./"); await expect(page.getByRole("alert")).toContainText("Default Space unavailable");
  await openFile(page); await expect(page.locator(".cm-content")).toContainText("Cold file words.");
  await expect.poll(() => finished(page)).toBe(true);
  expect(await disk(page, "folder:" + space.id, target.path)).toBe(original);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("native-file:space:") && /\.md$/.test(key)))).toEqual([]);
});

test("existing native file names bypass creation-name restrictions and retain their exact path", async ({ page }) => {
  const requested = { space, path: " leading note.MD" };
  await prepare(page, true, requested);
  await expect(page.locator(".cm-content")).toContainText("Cold file words.");
  await expect.poll(() => finished(page)).toBe(true);
  expect(await disk(page, "folder:" + space.id, requested.path)).toBe(original);
  expect(await disk(page, "folder:" + space.id, requested.path.trim())).toBeNull();
});
