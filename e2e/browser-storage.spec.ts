import { expect, test } from "./fixtures";
import { createSheet, openLibrary } from "./helpers";
import { readFile } from "node:fs/promises";

test("runs under the Pages subpath with CSP and no third-party requests", async ({ page }) => {
  const failures: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.hostname !== "127.0.0.1") external.push(request.url());
  });
  await openLibrary(page);
  await createSheet(page);
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute("content", /connect-src 'self'/);
  expect(external).toEqual([]);
  expect(failures).toEqual([]);
});

test("reloads offline with saved files and a working editor", async ({ page, context }) => {
  await openLibrary(page);
  await createSheet(page, "# Offline\n\nI keep my words offline.");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("I keep my words offline.");
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(" Still writing.");
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText("Saved");
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("Still writing.");
});

test("gives one tab write ownership and transfers it after flushing", async ({ page, context }) => {
  await openLibrary(page);
  await createSheet(page);
  const second = await context.newPage();
  await second.goto("./");
  await expect(second.getByText("Slate is open in another tab", { exact: false })).toBeVisible();
  await expect(second.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
  await second.getByRole("button", { name: "Use here", exact: true }).click();
  await expect(second.locator(".cm-content")).toHaveAttribute("contenteditable", "true");
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
  await second.locator(".cm-content").click();
  await second.keyboard.press("ControlOrMeta+End");
  await second.keyboard.insertText(" From the other tab.");
  await expect(second.locator(".workspaceStatus [role=status]")).toHaveText("Saved");
  await expect(page.locator(".cm-content")).toContainText("From the other tab.");
});

test("exports and reimports a Space without changing Markdown bytes", async ({ page }) => {
  await openLibrary(page);
  await createSheet(page, "# বাংলা\n\nMy words, my files.\n");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export .zip" }).click();
  const path = await (await download).path();
  expect(path).toBeTruthy();
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "Writing.zip", mimeType: "application/zip", buffer: await readFile(path!) });
  await expect(page.getByText("Imported your files. Existing files were kept.")).toBeVisible();
  const contents = await page.evaluate(async () => {
    const id = decodeURIComponent(location.hash.split("/")[2]!);
    const root = await navigator.storage.getDirectory();
    const spaces = await root.getDirectoryHandle("spaces");
    const space = await spaces.getDirectoryHandle(id);
    const inbox = await space.getDirectoryHandle("Inbox");
    return Promise.all(["Untitled.md", "Untitled (1).md"].map(async (name) => Array.from(new Uint8Array(await (await (await inbox.getFileHandle(name)).getFile()).arrayBuffer()))));
  });
  expect(contents[0]).toEqual(contents[1]);
});

test("writes selected-folder files and reconnects the saved handle", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Folder editing requires the File System Access picker.");
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => {
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle("picked-notes", { create: true });
    } });
  });
  await page.goto("./");
  await page.getByText("Open a folder", { exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await createSheet(page, "# Folder writing\n\nSaved in my folder.");
  const diskText = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle("picked-notes");
    const inbox = await folder.getDirectoryHandle("Inbox");
    return (await (await inbox.getFileHandle("Untitled.md")).getFile()).text();
  });
  expect(diskText).toBe("# Folder writing\n\nSaved in my folder.");
  await page.reload();
  await page.getByRole("button", { name: "Reconnect picked-notes" }).click();
  await expect(page.locator(".cm-content")).toContainText("Saved in my folder.");
});

test("builds an OPFS SQLite search cache in a worker without cross-origin isolation", async ({ page }) => {
  await openLibrary(page);
  await createSheet(page, "# Searchable\n\nAn unusual aardvark.");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  await expect.poll(() => page.evaluate(async () => {
    try {
      const id = decodeURIComponent(location.hash.split("/")[2]!);
      const indexes = await (await navigator.storage.getDirectory()).getDirectoryHandle("indexes");
      return (await (await indexes.getFileHandle(`${id}.sqlite`)).getFile()).size;
    } catch { return 0; }
  })).toBeGreaterThan(0);
  await expect(page.getByText("Search cache unavailable. Searching files directly.")).toBeHidden();
  // Reversed tokens match FTS but cannot pass the direct-file substring fallback.
  await page.getByRole("textbox", { name: "Search sheets" }).fill("aardvark unusual");
  await expect(page.getByRole("button", { name: /Searchable.*unusual aardvark/ })).toBeVisible();
});
