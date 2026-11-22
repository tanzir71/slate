import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { nativeFixture } from "./nativeFixture";

const before = "\uFEFFOriginal\r\n";
const folder = { id: "12345678-1234-4321-9876-123456789abc", name: "Chosen notes", path: "C:\\Chosen notes" };
const modal = (page: Page) => page.getByRole("dialog", { name: "Open in Slate", exact: true });
const bytes = (value: string) => Array.from(Buffer.from(value));
async function disk(page: Page, path = "Kept.md", space = "native-default") {
  return page.evaluate(({ path, space }) => JSON.parse(localStorage.getItem("native-file:" + (space === "native-default" ? "space:" : "folder:" + space + ":") + path) ?? "null") as number[] | null, { path, space });
}
async function prepare(page: Page, uri?: string, folders = false) {
  await nativeFixture(page, { "Kept.md": before, "Z.md": "Other native words." });
  if (uri) await page.addInitScript(uri => {
    if (!localStorage.getItem("native-url-seeded")) {
      localStorage.setItem("native-launch-inbox", JSON.stringify({ revision: 1, current: { id: "cold", url: uri, phase: "pending" }, queued: [] }));
      localStorage.setItem("native-url-seeded", "true");
    }
  }, uri);
  if (folders) await page.addInitScript(folder => {
    localStorage.setItem("native-spaces", JSON.stringify([{ id: "native-default", name: "Slate", path: null }, folder]));
    if (!localStorage.getItem("native-url-folder-seeded")) {
      localStorage.setItem("native-file:folder:" + folder.id + ":Kept.md", JSON.stringify(Array.from(new TextEncoder().encode("Folder original"))));
      localStorage.setItem("native-url-folder-seeded", "true");
    }
  }, folder);
  await page.goto("./?kept=1");
  await expect(page.locator(".browserWorkspace")).toHaveAttribute("data-editor-ready", "true");
}
async function launch(page: Page, uri: string) {
  await page.evaluate(uri => (Reflect.get(window, "__NATIVE_FIXTURE__") as { launch(uri: string): void }).launch(uri), uri);
}
async function chooseFolder(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Spaces", exact: true });
  await dialog.getByRole("button").filter({ hasText: folder.path }).click();
  await expect(dialog).toBeHidden();
}

test("native URL cold creation confirms exact text before writing", async ({ page }, info) => {
  const text = "\uFEFF# Linked\r\n\r\nবাংলা words.\r\n";
  await prepare(page, "slate://new?" + new URLSearchParams({ title: "Linked", notebook: "Work", text }));
  await expect(modal(page).getByLabel("Title", { exact: true })).toHaveValue("Linked");
  expect(await disk(page, "Work/Linked.md")).toBeNull(); expect(await disk(page)).toEqual(bytes(before));
  expect((await new AxeBuilder({ page }).include('dialog[aria-label="Open in Slate"]').analyze()).violations).toEqual([]);
  await info.attach("native-url-confirmation", { body: await modal(page).screenshot(), contentType: "image/png" });
  await modal(page).getByRole("button", { name: "Continue", exact: true }).click();
  await expect(modal(page)).toBeHidden(); await expect.poll(() => disk(page, "Work/Linked.md")).toEqual(bytes(text));
  await expect(page.locator(".cm-content")).toBeFocused(); expect(new URL(page.url()).search).toBe("?kept=1");
});
test("native URL cold open reads the requested note without changing files", async ({ page }) => {
  await prepare(page, "slate://open?path=Z.md");
  await expect(page.locator(".cm-content")).toHaveText("Other native words.");
  expect(await disk(page)).toEqual(bytes(before)); expect(await disk(page, "Z.md")).toEqual(bytes("Other native words."));
});
test("native URL cold search uses workspace search with its literal query", async ({ page }) => {
  await prepare(page, "slate://search?query=Other");
  const dialog = page.getByRole("dialog", { name: "Search everywhere", exact: true });
  await expect(dialog.getByRole("textbox", { name: /^Search in / })).toHaveValue("Other");
  await expect(dialog.getByRole("status")).toContainText("1 text match"); expect(await disk(page)).toEqual(bytes(before));
});
test("native URL warm append preserves physical text and one Undo", async ({ page }) => {
  await prepare(page); await launch(page, "slate://append?path=Kept.md&text=Native%0Awords");
  await expect(modal(page).getByLabel("Text to append", { exact: true })).toHaveValue("Native\nwords");
  expect(await disk(page)).toEqual(bytes(before)); await modal(page).getByRole("button", { name: "Continue", exact: true }).click();
  await expect(modal(page)).toBeHidden(); await expect.poll(() => disk(page)).toEqual(bytes(before + "\r\nNative\r\nwords"));
  await page.locator(".cm-content").press("ControlOrMeta+z"); await expect.poll(() => disk(page)).toEqual(bytes(before));
});
test("native URL queue retains current review and accepts the same URI again after cancellation", async ({ page }) => {
  await prepare(page); const first = "slate://new?title=First&text=One";
  await launch(page, first); await expect(modal(page).getByLabel("Title", { exact: true })).toHaveValue("First");
  await launch(page, "slate://new?title=Second&text=Two");
  await expect(modal(page).getByLabel("Title", { exact: true })).toHaveValue("First");
  await expect(page.getByRole("button", { name: "Review next request", exact: true })).toBeDisabled();
  await modal(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(modal(page)).toBeHidden(); await page.getByRole("button", { name: "Review next request", exact: true }).click();
  await expect(modal(page).getByLabel("Title", { exact: true })).toHaveValue("Second");
  await modal(page).getByRole("button", { name: "Cancel", exact: true }).click(); await expect(modal(page)).toBeHidden();
  await launch(page, first); await expect(modal(page).getByLabel("Title", { exact: true })).toHaveValue("First");
  await modal(page).getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => disk(page, "Inbox/First.md")).toEqual(bytes("One")); expect(await disk(page, "Inbox/Second.md")).toBeNull();
});
for (const marker of ["complete", "applied"]) test(`native URL ${marker} failure retries completion without another creation`, async ({ page }) => {
  await prepare(page); await page.evaluate(marker => localStorage.setItem("native-fail-" + marker, "true"), marker);
  await launch(page, "slate://new?title=Once&text=One"); await modal(page).getByRole("button", { name: "Continue", exact: true }).click();
  await expect(modal(page).getByRole("alert")).toHaveText("Finishing unavailable"); await expect.poll(() => disk(page, "Inbox/Once.md")).toEqual(bytes("One"));
  await page.evaluate(marker => localStorage.removeItem("native-fail-" + marker), marker);
  await modal(page).getByRole("button", { name: "Finish request", exact: true }).click(); await expect(modal(page)).toBeHidden();
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("native-file:space:Inbox/")))).toEqual(["native-file:space:Inbox/Once.md"]);
});
test("native URL interrupted reload requires review and keeps already-written bytes", async ({ page }) => {
  await prepare(page); await page.evaluate(() => localStorage.setItem("native-fail-applied", "true"));
  await launch(page, "slate://append?path=Kept.md&text=Added"); await modal(page).getByRole("button", { name: "Continue", exact: true }).click();
  await expect(modal(page).getByRole("alert")).toHaveText("Finishing unavailable"); const expected = bytes(before + "\r\nAdded");
  await expect.poll(() => disk(page)).toEqual(expected); await page.reload();
  const interrupted = page.getByRole("dialog", { name: "Review interrupted request", exact: true });
  await expect(interrupted).toBeVisible(); expect(await disk(page)).toEqual(expected);
  await interrupted.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(interrupted).toBeHidden(); expect(await disk(page)).toEqual(expected);
});
test("native URL target Space requires the picker and writes only the chosen folder", async ({ page }) => {
  await prepare(page, "slate://append?" + new URLSearchParams({ space: folder.id, path: "Kept.md", text: "Added" }), true);
  await expect(modal(page).getByRole("alert")).toContainText("This link targets another Space");
  await expect(modal(page).getByLabel("Text to append", { exact: true })).toBeDisabled();
  await modal(page).getByRole("button", { name: "Switch Space", exact: true }).click(); await chooseFolder(page);
  await expect(modal(page).getByLabel("Text to append", { exact: true })).toBeEnabled();
  await modal(page).getByRole("button", { name: "Continue", exact: true }).click(); await expect(modal(page)).toBeHidden();
  await expect.poll(() => disk(page, "Kept.md", folder.id)).toEqual(bytes("Folder original\n\nAdded")); expect(await disk(page)).toEqual(bytes(before));
});
test("native URL unscoped review keeps its original folder after renderer reload", async ({ page }) => {
  await prepare(page, undefined, true); await page.locator(".spaceSwitcher").click(); await chooseFolder(page);
  await launch(page, "slate://append?path=Kept.md&text=Added"); await expect(modal(page).getByLabel("Text to append", { exact: true })).toBeEnabled();
  // Reopen another admitted Space explicitly; the pending URI must keep its original binding.
  await page.evaluate(() => localStorage.setItem("native-last-space", "native-default"));
  await page.reload(); await expect(modal(page).getByRole("alert")).toContainText("This link targets another Space");
  expect(await disk(page)).toEqual(bytes(before));
  await modal(page).getByRole("button", { name: "Switch Space", exact: true }).click(); await chooseFolder(page);
  await modal(page).getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => disk(page, "Kept.md", folder.id)).toEqual(bytes("Folder original\n\nAdded")); expect(await disk(page)).toEqual(bytes(before));
});

test("native URL unscoped review reopens the remembered folder without changing its binding", async ({ page }) => {
  await prepare(page, undefined, true); await page.locator(".spaceSwitcher").click(); await chooseFolder(page);
  await launch(page, "slate://append?path=Kept.md&text=Added"); await expect(modal(page).getByLabel("Text to append", { exact: true })).toBeEnabled();
  await page.reload(); await expect(page.locator(".spaceSwitcher")).toContainText(folder.name);
  await expect(modal(page).getByLabel("Text to append", { exact: true })).toBeEnabled();
  expect(await disk(page, "Kept.md", folder.id)).toEqual(bytes("Folder original")); expect(await disk(page)).toEqual(bytes(before));
  await modal(page).getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => disk(page, "Kept.md", folder.id)).toEqual(bytes("Folder original\n\nAdded")); expect(await disk(page)).toEqual(bytes(before));
});
test("native URL invalid paths remain a cancellable error without file mutations", async ({ page }) => {
  await prepare(page, "slate://append?path=..%2Foutside.md&text=No");
  await expect(modal(page).getByRole("alert")).toBeVisible(); await expect(modal(page).getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  expect(await disk(page)).toEqual(bytes(before)); await modal(page).getByRole("button", { name: "Cancel", exact: true }).click(); await expect(modal(page)).toBeHidden();
});
test("native URL lost start reply retries the same claim before writing once", async ({ page }) => {
  await prepare(page); await page.evaluate(() => localStorage.setItem("native-fail-begin-after-claim", "true"));
  await launch(page, "slate://new?title=Claimed&text=One"); await modal(page).getByRole("button", { name: "Continue", exact: true }).click();
  await expect(modal(page).getByRole("alert")).toHaveText("Review reply unavailable"); expect(await disk(page, "Inbox/Claimed.md")).toBeNull();
  await modal(page).getByRole("button", { name: "Continue", exact: true }).click(); await expect(modal(page)).toBeHidden();
  await expect.poll(() => disk(page, "Inbox/Claimed.md")).toEqual(bytes("One"));
});
test("native URL templates prefill the gallery and wait for explicit creation", async ({ page }, info) => {
  const text = "Literal {{clipboard}} and {{prompt:Secret}} stay text.";
  await prepare(page, "slate://new?" + new URLSearchParams({ template: "meeting-notes", title: "Review: next", notebook: "Work", text }));
  const dialog = page.getByRole("dialog", { name: "New from template", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Review: next");
  await expect(dialog.getByRole("textbox", { name: "Additional text", exact: true })).toHaveValue(text);
  await expect(dialog.getByText("Reading Space templates…")).toHaveCount(0);
  const day = await dialog.getByLabel("Date", { exact: true }).inputValue(), path = `Work/${day}-review-next.md`;
  expect(await disk(page, path)).toBeNull();
  await info.attach("native-url-template", { body: await dialog.screenshot(), contentType: "image/png" });
  await dialog.getByRole("button", { name: "Create ↵", exact: true }).click(); await expect(dialog).toBeHidden();
  await expect.poll(async () => new TextDecoder().decode(new Uint8Array(await disk(page, path) ?? []))).toContain('title: "Review: next"');
  expect(new TextDecoder().decode(new Uint8Array(await disk(page, path) ?? [])).endsWith(text)).toBe(true);
});
