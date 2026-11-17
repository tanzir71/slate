import type { BrowserIndex } from "@slate/ui/browser";

export function createBrowserIndex(spaceId: string): BrowserIndex {
  const worker = new Worker(new URL("./index.worker.ts", import.meta.url), { type: "module" });
  let sequence = 0;
  const pending = new Map<number, { resolve(value: string[]): void; reject(error: Error): void }>();
  worker.onmessage = (event: MessageEvent<{ id: number; result?: string[]; error?: string }>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (event.data.error) request.reject(new Error(event.data.error));
    else request.resolve(event.data.result ?? []);
  };
  worker.onerror = () => {
    for (const request of pending.values()) request.reject(new Error("Search worker failed"));
    pending.clear();
  };
  function send(method: string, body: object): Promise<string[]> {
    const id = ++sequence;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, spaceId, method, ...body }); });
  }
  return {
    async rebuild(sheets) { await send("rebuild", { sheets }); },
    search(query) { return send("search", { query }); },
    close() { worker.terminate(); for (const request of pending.values()) request.reject(new Error("Space closed")); pending.clear(); }
  };
}
