import { expect, test } from "./fixtures";
import { createSheet, expectSavedSheet, openLibrary, readCurrentSheet, replaceEditorText, showSheets, workspaceAction } from "./helpers";
import { readFile } from "node:fs/promises";

test("runs under the Pages subpath with CSP and no third-party requests", async ({ page }) => {
  const started = Date.now();
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
  expect(Date.now() - started, "First visit to saved writing must take less than 60 seconds").toBeLessThan(60_000);
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute("content", /connect-src 'self'/);
  expect(external).toEqual([]);
  expect(failures).toEqual([]);
});

test("reloads offline with saved files and a working editor", async ({ page, context }, testInfo) => {
  try {
  await openLibrary(page);
  await createSheet(page, "# Offline\n\nI keep my words offline.");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  // Record readiness in the browser; test-runner polling can add half a second.
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const editor = document.querySelector<HTMLElement>('.cm-content[contenteditable="true"]');
      if (!editor?.textContent?.includes("I keep my words offline.")) return;
      observer.disconnect();
      requestAnimationFrame(() => {
        const bounds = editor.getBoundingClientRect();
        if (editor.isConnected && bounds.width && bounds.height) performance.mark("slate.offline-editor-ready");
      });
    });
    observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["contenteditable"] });
  });
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".cm-content")).toContainText("I keep my words offline.");
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "true");
  await page.waitForFunction(() => performance.getEntriesByName("slate.offline-editor-ready").length > 0);
  const reopenMs = await page.evaluate(() => performance.getEntriesByName("slate.offline-editor-ready")[0]!.startTime);
  console.log(`Offline reopen (${testInfo.project.name}): ${Math.round(reopenMs)} ms`);
  await testInfo.attach("offline-reopen", { body: JSON.stringify({ reopenMs }), contentType: "application/json" });
  expect(reopenMs, "Offline return to an editable sheet must take less than 1 second").toBeLessThan(1000);
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(" Still writing.");
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText("Saved");
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("Still writing.");
  } finally {
    const stages = await page.evaluate(() => performance.getEntriesByType("mark")
      .filter((entry) => entry.name.startsWith("slate.open."))
      .map(({ name, startTime }) => ({ name, startTime }))).catch(() => []);
    await testInfo.attach("offline-opening-stages", { body: JSON.stringify(stages), contentType: "application/json" });
  }
});

test("refreshes an invalidated file snapshot once and surfaces persistent read errors", async ({ page }) => {
  await openLibrary(page);
  const source = "# Snapshot\n\nKeep these bytes.";
  await createSheet(page, source);
  await page.evaluate(() => {
    const probe = { reads: 0, remaining: 1, name: "NotReadableError" };
    Reflect.set(window, "snapshotReadProbe", probe);
    const getFile = FileSystemFileHandle.prototype.getFile;
    FileSystemFileHandle.prototype.getFile = async function () {
      const file = await getFile.call(this);
      if (this.name !== "Untitled.md") return file;
      const text = file.text.bind(file);
      Object.defineProperty(file, "text", { value: async () => {
        probe.reads++;
        if (probe.remaining > 0) { probe.remaining--; throw new DOMException("Test snapshot invalidated", probe.name); }
        return text();
      } });
      return file;
    };
  });
  const probe = () => page.evaluate(() => Reflect.get(window, "snapshotReadProbe") as { reads: number; remaining: number; name: string });
  expect(await readCurrentSheet(page)).toBe(source);
  expect((await probe()).reads).toBe(2);
  await page.evaluate(() => Object.assign(Reflect.get(window, "snapshotReadProbe"), { reads: 0, remaining: 2 }));
  await expect(readCurrentSheet(page)).rejects.toThrow("Test snapshot invalidated");
  expect((await probe()).reads).toBe(2);
  await page.evaluate(() => Object.assign(Reflect.get(window, "snapshotReadProbe"), { reads: 0, remaining: 1, name: "NotAllowedError" }));
  await expect(readCurrentSheet(page)).rejects.toThrow("Test snapshot invalidated");
  expect((await probe()).reads).toBe(1);
  await page.evaluate(() => Object.assign(Reflect.get(window, "snapshotReadProbe"), { remaining: 0 }));
  expect(await readCurrentSheet(page)).toBe(source);
});

test("gives one tab write ownership and transfers it after flushing", async ({ page, context }) => {
  // Two cold tab loads must leave time for the existing 15 s save assertion.
  test.setTimeout(60_000);
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
  await expect(second.locator(".workspaceStatus [role=status]")).toHaveText("Saved", { timeout: 15_000 });
  await expect(page.locator(".cm-content")).toContainText("From the other tab.");
});

test("recovers the writer's latest failed save when another tab takes over", async ({ page, context }) => {
  await openLibrary(page);
  await createSheet(page, "Saved base.");
  await page.evaluate(() => {
    FileSystemFileHandle.prototype.createWritable = async () => { throw new DOMException("Test write permission revoked", "NotAllowedError"); };
  });
  await replaceEditorText(page, "Early recovery draft.");
  await expect(page.getByRole("alert")).toContainText("Test write permission revoked");
  const reader = await context.newPage();
  await reader.goto("./");
  await expect(reader.locator(".cm-content")).toContainText("Early recovery draft.");
  await expect(reader.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
  const previousJournal = await page.evaluate(() => localStorage.getItem(`slate.recovery-v2.${decodeURIComponent(location.hash.split("/")[2]!)}`));
  await replaceEditorText(page, "Latest words before the writer disappeared.");
  await expect.poll(() => page.evaluate(() => localStorage.getItem(`slate.recovery-v2.${decodeURIComponent(location.hash.split("/")[2]!)}`))).not.toBe(previousJournal);
  await page.close();
  await reader.getByRole("button", { name: "Use here", exact: true }).click();
  await expect(reader.locator(".cm-content")).toContainText("Latest words before the writer disappeared.");
  await expect(reader.locator(".workspaceStatus [role=status]")).toHaveText("Saved");
  await reader.reload();
  await expect(reader.locator(".cm-content")).toContainText("Latest words before the writer disappeared.");
});

test("keeps drafts from an older open app separate from the new recovery journal", async ({ page, context }) => {
  await openLibrary(page);
  await createSheet(page, "Saved base.");
  await page.evaluate(() => {
    FileSystemFileHandle.prototype.createWritable = async () => { throw new DOMException("Test write permission revoked", "NotAllowedError"); };
  });
  const newer = "# New app\n\nKeep these newer words.";
  const older = "# Earlier app\n\nKeep these earlier words.";
  await replaceEditorText(page, newer);
  await expect(page.getByRole("alert")).toContainText("Test write permission revoked");
  const reader = await context.newPage();
  await reader.goto("./");
  await expect(reader.locator(".cm-content")).toContainText("Keep these newer words.");
  await expect(reader.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
  const protectedJournal = await page.evaluate((older) => {
    const parts = location.hash.split("/");
    const id = decodeURIComponent(parts[2]!);
    const path = decodeURIComponent(parts[4]!);
    const key = `slate.recovery-v2.${id}`;
    const before = localStorage.getItem(key);
    localStorage.removeItem(`slate.recovery.${id}`);
    localStorage.setItem(`slate.recovery.${id}`, JSON.stringify({ [path]: { content: older, baseContent: "Saved base." } }));
    return !!before && before === localStorage.getItem(key);
  }, older);
  expect(protectedJournal).toBe(true);
  await page.close();
  await reader.getByRole("button", { name: "Use here", exact: true }).click();
  await expect(reader.locator(".workspaceStatus [role=status]")).toHaveText("Saved", { timeout: 15_000 });
  expect(await readCurrentSheet(reader)).toBe(newer);
  await showSheets(reader);
  await reader.locator(".browserSheetRow").filter({ hasText: "Earlier app" }).click();
  await expect(reader.locator(".cm-content")).toContainText("Keep these earlier words.");
  expect(await readCurrentSheet(reader)).toBe(older);
});

test("exports and reimports a Space without changing Markdown bytes", async ({ page }) => {
  await openLibrary(page);
  await createSheet(page, "# বাংলা\n\nMy words, my files.\n");
  const download = page.waitForEvent("download");
  await workspaceAction(page, "Export .zip");
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

test("keeps unsupported Markdown read-only and downloads its original bytes", async ({ page }) => {
  await openLibrary(page);
  const original = Buffer.from([0xff, 0xfe, 0x41, 0, 0x42, 0]);
  await page.getByLabel("Import files", { exact: true }).setInputFiles({ name: "Legacy.md", mimeType: "text/markdown", buffer: original });
  await showSheets(page);
  await page.locator(".browserSheetRow").filter({ hasText: "Legacy" }).click();
  await expect(page.getByRole("heading", { name: "This file needs UTF-8." })).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await page.getByRole("button", { name: "Sheet actions", exact: true }).click();
  for (const name of ["Rename sheet", "Move sheet", "Delete sheet"]) await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  const menu = page.locator(".sheetActionsMenu");
  if (await menu.evaluate((element) => element.hasAttribute("open"))) await page.getByRole("button", { name: "Sheet actions", exact: true }).click();
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText("Read-only");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download original" }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("Legacy.md");
  expect(await readFile((await download.path())!)).toEqual(original);
  await showSheets(page);
  await expect(page.getByRole("button", { name: "Select sheets", exact: true })).toBeDisabled();
  await createSheet(page, "My new UTF-8 words.");
  await expect(page.locator(".cm-content")).toContainText("My new UTF-8 words.");
});

test("writes selected-folder files and reconnects the saved handle", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Folder editing requires the File System Access picker.");
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => {
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle("picked-notes", { create: true });
    } });
    const active = new Set<{ callback(): void; recursive: boolean }>();
    const pending: (() => void)[] = [];
    let creations = 0;
    const update = () => { document.documentElement.dataset.observingFolder = String([...active].some((observer) => observer.recursive)); };
    Object.defineProperty(window, "notifyFolderChange", { value: () => { for (const observer of active) observer.callback(); } });
    Object.defineProperty(window, "settleFolderObservers", { value: () => { for (const resolve of pending.splice(0)) resolve(); } });
    Object.defineProperty(window, "FileSystemObserver", { configurable: true, value: class {
      recursive = false;
      constructor(readonly callback: () => void) { document.documentElement.dataset.folderObserverCreations = String(++creations); }
      async observe(_handle: unknown, options: { recursive: boolean }) {
        await new Promise<void>((resolve) => pending.push(resolve));
        this.recursive = options.recursive;
        active.add(this);
        update();
      }
      disconnect() { active.delete(this); update(); }
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
  await page.locator(".cm-content").focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("/");
  await expect(page.locator(".cm-content .cm-line")).toHaveText(["/"]);
  const blocks = page.getByRole("dialog", { name: "Insert block", exact: true });
  await expect(blocks.getByText("Templates", { exact: true })).toBeVisible();
  await expect(blocks.getByText("Snippets", { exact: true })).toBeVisible();
  await expect(blocks.getByRole("button", { name: "Manage custom blocks", exact: true, includeHidden: true })).toBeAttached();
  await page.evaluate(async () => {
    (window as Window & { settleFolderObservers(): void }).settleFolderObservers();
    await Promise.resolve();
    await Promise.resolve();
  });
  await expect(page.locator("html")).toHaveAttribute("data-observing-folder", "true");
  await expect(page.locator("html")).toHaveAttribute("data-folder-observer-creations", "1");
  await page.keyboard.press("Escape");
  await replaceEditorText(page, "# Folder writing\n\nSaved in my folder.");
  await expectSavedSheet(page, "# Folder writing\n\nSaved in my folder.", (target) => target.evaluate(async () => {
    const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle("picked-notes");
    const inbox = await folder.getDirectoryHandle("Inbox");
    return (await (await inbox.getFileHandle("Untitled.md")).getFile()).text();
  }));
  await page.evaluate(async () => {
    const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle("picked-notes");
    const inbox = await folder.getDirectoryHandle("Inbox");
    const writer = await (await inbox.getFileHandle("Untitled.md")).createWritable();
    await writer.write("# Folder writing\n\nAn external revision.");
    await writer.close();
    (window as Window & { notifyFolderChange(): void }).notifyFolderChange();
  });
  await expect(page.locator(".cm-content")).toContainText("An external revision.", { timeout: 500 });
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Reconnect picked-notes" }).click();
  await expect(page.locator(".cm-content")).toContainText("An external revision.");
});

test("starts an OPFS SQLite cache after the editor is ready and searches real FTS", async ({ page }) => {
  await openLibrary(page);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(page.workers().filter((worker) => worker.url().includes("index.worker"))).toHaveLength(0);
  await createSheet(page, "# Searchable\n\nAn unusual aardvark.");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  // A file snapshot is not a search-readiness signal. Exercise the worker's query path.
  await showSheets(page);
  const search = page.getByRole("textbox", { name: "Search sheets", exact: true });
  await search.fill("no_such_search_word");
  await expect(page.locator(".browserSheetRow")).toHaveCount(0);
  // Reversed tokens match FTS but cannot pass the direct-file substring fallback.
  await search.fill("aardvark unusual");
  await expect(page.getByRole("button", { name: /Searchable.*unusual aardvark/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Search cache unavailable. Searching files directly.")).toBeHidden();
  expect(page.workers().filter((worker) => worker.url().includes("index.worker"))).toHaveLength(1);
  expect(await page.evaluate(async () => {
    const id = decodeURIComponent(location.hash.split("/")[2]!);
    const indexes = await (await navigator.storage.getDirectory()).getDirectoryHandle("indexes");
    return (await indexes.getFileHandle(`${id}.sqlite`)).name;
  })).toMatch(/\.sqlite$/);
});
