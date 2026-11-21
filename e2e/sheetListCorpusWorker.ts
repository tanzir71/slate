import type { Page } from "@playwright/test";

type SeedRequest = { id: string; start: number; step: number; count: number };
type SeedReply = { written: number } | { error: string };
interface SyncAccess {
  truncate(size: number): void;
  write(bytes: Uint8Array, options: { at: number }): number;
  read(bytes: Uint8Array, options: { at: number }): number;
  getSize(): number;
  close(): void;
}

/** Stringified into a dedicated worker; every original fixture byte is read back. */
export function installSheetListSeedWorker() {
  const scope = globalThis as unknown as {
    onmessage: ((event: MessageEvent<SeedRequest>) => void) | null;
    postMessage(reply: SeedReply): void;
  };
  scope.onmessage = async ({ data: { id, start, step, count } }) => {
    try {
      const root = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("spaces")).getDirectoryHandle(id);
      const encoder = new TextEncoder();
      let written = 0;
      for (let index = start; index < count; index += step) {
        const file = await root.getFileHandle(`Note${String(index).padStart(3, "0")}.md`, { create: true }) as FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccess> };
        const access = await file.createSyncAccessHandle();
        try {
          const bytes = encoder.encode(`# Note ${index}\n\nExact writing ${index}.`);
          access.truncate(0);
          if (access.write(bytes, { at: 0 }) !== bytes.length) throw new Error("Sheet-list fixture write was incomplete.");
          const actual = new Uint8Array(bytes.length);
          if (access.getSize() !== bytes.length || access.read(actual, { at: 0 }) !== bytes.length || actual.some((byte, position) => byte !== bytes[position]))
            throw new Error("Sheet-list fixture bytes did not round-trip.");
        } finally { access.close(); }
        written++;
      }
      scope.postMessage({ written });
    } catch (cause) { scope.postMessage({ error: String(cause) }); }
  };
}

export async function writeSheetListCorpusFiles(page: Page, id: string): Promise<number> {
  return page.evaluate(async ({ script, id }) => {
    const url = URL.createObjectURL(new Blob([`(${script})()`], { type: "text/javascript" }));
    const workers: Worker[] = [];
    try {
      const counts = await Promise.all(Array.from({ length: 4 }, (_, start) => new Promise<number>((resolve, reject) => {
        const worker = new Worker(url); workers.push(worker);
        worker.onmessage = ({ data }: MessageEvent<SeedReply>) => {
          if ("error" in data) reject(new Error(data.error)); else resolve(data.written);
        };
        worker.onerror = event => reject(new Error(event.message));
        worker.onmessageerror = () => reject(new Error("Sheet-list fixture reply was unreadable."));
        worker.postMessage({ id, start, step: 4, count: 100 });
      })));
      return counts.reduce((total, count) => total + count, 0);
    } finally { workers.forEach(worker => worker.terminate()); URL.revokeObjectURL(url); }
  }, { script: installSheetListSeedWorker.toString(), id });
}
