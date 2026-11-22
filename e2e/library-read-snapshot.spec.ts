import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { createSheet, openLibrary } from "./helpers";
import { libraryFile, libraryFileMatches } from "./libraryFiles";

async function replaceAfterSnapshot(page: Page, path: string, source: string) {
  await libraryFile(page, path, "Original snapshot\r\n");
  await page.evaluate(async ({ path, source }) => {
    let directory = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("spaces"))
      .getDirectoryHandle(decodeURIComponent(location.hash.split("/")[2]!));
    const parts = path.split("/"), name = parts.pop()!;
    for (const part of parts) directory = await directory.getDirectoryHandle(part);
    const handle = await directory.getFileHandle(name), snapshot = await handle.getFile();
    const url = URL.createObjectURL(new Blob([`
      self.onmessage = async ({ data }) => {
        try {
          let directory = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("spaces")).getDirectoryHandle(data.spaceId);
          const parts = data.path.split("/"), name = parts.pop();
          for (const part of parts) directory = await directory.getDirectoryHandle(part);
          const handle = await directory.getFileHandle(name), access = await handle.createSyncAccessHandle();
          try {
            const bytes = new TextEncoder().encode(data.source);
            access.truncate(0);
            if (access.write(bytes, { at: 0 }) !== bytes.length) throw Error("Snapshot probe write was incomplete");
            access.flush();
          }
          finally { access.close(); }
          self.postMessage({ done: true });
        } catch (error) { self.postMessage({ error: String(error) }); }
      };
    `], { type: "text/javascript" }));
    const worker = new Worker(url);
    try {
      await new Promise<void>((resolve, reject) => {
        worker.onerror = reject;
        worker.onmessage = (event: MessageEvent<{ done?: boolean; error?: string }>) => event.data.error ? reject(Error(event.data.error)) : resolve();
        worker.postMessage({ spaceId: decodeURIComponent(location.hash.split("/")[2]!), path, source });
      });
    } finally { worker.terminate(); URL.revokeObjectURL(url); }
    // Inject the observed read fault: engines differ in whether a held File stays readable.
    Object.defineProperty(snapshot, "arrayBuffer", { value: async () => {
      throw new DOMException("File changed after acquisition", "NotReadableError");
    } });
    const prototype = Object.getPrototypeOf(handle) as { getFile(this: FileSystemFileHandle): Promise<File> };
    const getFile = prototype.getFile, receipts: string[] = [];
    Reflect.set(window, "__SNAPSHOT_PROBE__", receipts);
    prototype.getFile = async function () {
      if (this.name !== name) return getFile.call(this);
      if (!receipts.length) { receipts.push("stale"); return snapshot; }
      receipts.push("fresh"); prototype.getFile = getFile; return getFile.call(this);
    };
  }, { path, source });
}
test("read-only file polls reacquire an unreadable File and still require complete exact bytes", async ({ page }) => {
  await openLibrary(page);
  await createSheet(page, "# Snapshot observer\n");
  const source = "\ufeff# Current\r\nবাংলা words.\r\n";
  await replaceAfterSnapshot(page, ".slate/probes/snapshot-bytes.txt", source);
  await expect.poll(() => libraryFile(page, ".slate/probes/snapshot-bytes.txt")).toEqual(Array.from(Buffer.from(source)));
  expect(await page.evaluate(() => Reflect.get(window, "__SNAPSHOT_PROBE__") as string[])).toEqual(["stale", "fresh"]);
  await replaceAfterSnapshot(page, ".slate/probes/snapshot-matches.txt", source);
  await expect.poll(() => libraryFileMatches(page, ".slate/probes/snapshot-matches.txt", source)).toBe(true);
  expect(await page.evaluate(() => Reflect.get(window, "__SNAPSHOT_PROBE__") as string[])).toEqual(["stale", "fresh"]);
});
