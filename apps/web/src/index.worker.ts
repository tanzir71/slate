import { loadWebOpfsSqliteIndex, type WebOpfsSqliteIndex } from "@slate/storage/web-opfs";
import { markdownFileToSqliteIndexRow } from "@slate/storage/runtime";

interface IndexRequest { id: number; spaceId: string; method: "rebuild" | "search"; sheets?: { path: string; content: string }[]; query?: string }
let index: WebOpfsSqliteIndex | undefined;
let queue = Promise.resolve();
const worker = globalThis as unknown as { onmessage: ((event: MessageEvent<IndexRequest>) => void) | null; postMessage(message: unknown): void };

worker.onmessage = (event) => {
  const request = event.data;
  queue = queue.then(async () => {
    try {
      index ??= await loadWebOpfsSqliteIndex({ path: `indexes/${request.spaceId}.sqlite` });
      let result: string[] = [];
      if (request.method === "rebuild") await index.replaceRows((request.sheets ?? []).map((sheet) => markdownFileToSqliteIndexRow(sheet.path, sheet.content)));
      else result = (await index.searchSheets(request.query ?? "")).map((sheet) => sheet.path);
      worker.postMessage({ id: request.id, result });
    } catch (error) {
      worker.postMessage({ id: request.id, error: error instanceof Error ? error.message : "Search cache unavailable" });
    }
  });
};
