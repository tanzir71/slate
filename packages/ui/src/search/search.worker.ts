import { searchWorkspace, type SearchSheet } from "./searchResults";
import type { SearchWorkerReply, SearchWorkerRequest } from "./searchWorkerProtocol";

let version = 0, sheets: readonly SearchSheet[] = [];
self.onmessage = ({ data }: MessageEvent<SearchWorkerRequest>) => {
  let reply: SearchWorkerReply;
  try {
    if (data.sheets) { sheets = data.sheets; version = data.version; }
    if (version !== data.version) throw new Error("The search source changed. Search again.");
    reply = { id: data.id, version, kind: "result", result: searchWorkspace(sheets, data.query, data.options) };
  } catch (cause) { reply = { id: data.id, version: data.version, kind: "error", message: cause instanceof Error ? cause.message : String(cause) }; }
  self.postMessage(reply);
};
