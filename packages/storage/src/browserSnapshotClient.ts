import type { BrowserDirectoryHandle } from "./browserFiles";
import type { MarkdownFileSnapshot } from "./fileIO";
import type { DirectorySnapshotReply, DirectorySnapshotRequest } from "./browserSnapshotProtocol";

export interface DirectorySnapshotWorker {
  postMessage(request: DirectorySnapshotRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<DirectorySnapshotReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}
class SnapshotTransportError extends Error {}
const createWorker = (): DirectorySnapshotWorker | undefined => typeof Worker === "undefined" ? undefined
  : new Worker(new URL("./browserSnapshot.worker.ts", import.meta.url), { type: "module" });

function requestSnapshot(worker: DirectorySnapshotWorker, root: BrowserDirectoryHandle, id: number): Promise<MarkdownFileSnapshot[]> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; };
    const failed = () => { cleanup(); reject(new SnapshotTransportError()); };
    worker.onerror = event => { event.preventDefault(); failed(); };
    worker.onmessageerror = failed;
    worker.onmessage = ({ data }) => {
      if (!data || data.id !== id) { failed(); return; }
      if (data.kind === "snapshot" && Array.isArray(data.sheets)) { cleanup(); resolve(data.sheets); }
      else if (data.kind === "error" && typeof data.name === "string" && typeof data.message === "string") {
        cleanup(); const error = new Error(data.message); error.name = data.name; reject(error);
      } else failed();
    };
    try { worker.postMessage({ id, root }); } catch { failed(); }
  });
}

/** Serialize fresh reads of this exact root; release its worker when the queue drains. */
export function createDirectorySnapshotReader(root: BrowserDirectoryHandle, fallback: () => Promise<MarkdownFileSnapshot[]>, makeWorker = createWorker) {
  let worker: DirectorySnapshotWorker | undefined, unavailable = false, queued = 0, id = 0;
  let pending: Promise<unknown> = Promise.resolve();
  const release = () => { worker?.terminate(); worker = undefined; };
  return (): Promise<MarkdownFileSnapshot[]> => {
    queued++;
    const result = pending.then(async () => {
      if (!unavailable && !worker) {
        try { worker = makeWorker(); } catch { unavailable = true; }
        if (!worker) unavailable = true;
      }
      if (unavailable) return fallback();
      try { return await requestSnapshot(worker!, root, ++id); }
      catch (cause) {
        if (!(cause instanceof SnapshotTransportError)) throw cause;
        unavailable = true; release();
        return fallback();
      }
    });
    pending = result.catch(() => undefined);
    return result.finally(() => { if (--queued === 0) release(); });
  };
}
