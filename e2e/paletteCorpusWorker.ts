import type { Page } from "@playwright/test";

type SeedRequest = { id: string; count: number; start: number; step: number };
type SeedReply = { written: number } | { error: string };
interface SyncAccess {
  write(bytes: Uint8Array): number;
  truncate(size: number): void;
  close(): void;
}

/** Stringified as a dedicated worker; it depends only on browser globals. */
function seedInWorker() {
  const scope = globalThis as unknown as {
    onmessage: ((event: MessageEvent<SeedRequest>) => void) | null;
    postMessage(reply: SeedReply): void;
  };
  scope.onmessage = async ({ data: { id, count, start, step } }) => {
    try {
      const root = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("spaces")).getDirectoryHandle(id);
      const notes = await root.getDirectoryHandle("Notes", { create: true });
      const encoder = new TextEncoder();
      let written = 0;
      for (let index = start; index < count; index += step) {
        const number = String(index).padStart(5, "0");
        const file = await notes.getFileHandle(`note-${number}.md`, { create: true }) as FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccess> };
        const handle = await file.createSyncAccessHandle();
        try {
          const bytes = encoder.encode(`# Note ${number}\n\nWords kept in real file ${number}. #reference\n`);
          handle.truncate(0);
          if (handle.write(bytes) !== bytes.length) throw new Error("Corpus file write was incomplete.");
        } finally { handle.close(); }
        written++;
      }
      scope.postMessage({ written });
    } catch (error) { scope.postMessage({ error: String(error) }); }
  };
}

export async function writePaletteCorpusFiles(page: Page, id: string, count: number) {
  return page.evaluate(async ({ script, id, count }) => {
    const url = URL.createObjectURL(new Blob([`(${script})()`], { type: "text/javascript" }));
    const workers: Worker[] = [];
    const step = Math.min(4, count - 1);
    try {
      const counts = await Promise.all(Array.from({ length: step }, (_, slot) => new Promise<number>((resolve, reject) => {
        const worker = new Worker(url); workers.push(worker);
        worker.onmessage = ({ data }: MessageEvent<SeedReply>) => {
          worker.terminate();
          if ("error" in data) reject(new Error(data.error)); else resolve(data.written);
        };
        worker.onerror = (event) => reject(new Error(event.message));
        worker.postMessage({ id, count, start: slot + 1, step });
      })));
      return counts.reduce((total, count) => total + count, 0);
    } finally { workers.forEach((worker) => worker.terminate()); URL.revokeObjectURL(url); }
  }, { script: seedInWorker.toString(), id, count });
}
