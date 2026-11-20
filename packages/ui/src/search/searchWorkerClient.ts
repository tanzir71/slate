import type { LiteralSearchOptions } from "@slate/core";
import type { SearchSheet, WorkspaceSearchResult } from "./searchResults";
import type { SearchWorkerReply, SearchWorkerRequest } from "./searchWorkerProtocol";

export interface SearchWorker {
  postMessage(request: SearchWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<SearchWorkerReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
interface Job {
  readonly id: number; readonly sheets: readonly SearchSheet[]; readonly query: string; readonly options: LiteralSearchOptions;
  readonly resolve: (result: WorkspaceSearchResult) => void; readonly reject: (cause: Error | DOMException) => void;
  version?: number;
}
const cancelled = () => new DOMException("A newer search replaced this request.", "AbortError");
const sameSheets = (a: readonly SearchSheet[] | undefined, b: readonly SearchSheet[]) => a === b ||
  (!!a && a.length === b.length && a.every((sheet, index) => sheet.path === b[index]!.path && sheet.content === b[index]!.content && !!sheet.unsupportedEncoding === !!b[index]!.unsupportedEncoding));

/** One active search and one latest request; unchanged sources stay in the worker. */
export function createSearchWorkerClient(worker: SearchWorker) {
  let id = 0, version = 0, closed = false;
  let inFlight: number | undefined, active: Job | undefined, pending: Job | undefined;
  let sent: readonly SearchSheet[] | undefined;
  function close(cause: Error | DOMException = new DOMException("Search was closed.", "AbortError")) {
    if (closed) return;
    closed = true; active?.reject(cause); pending?.reject(cause);
    active = pending = undefined; inFlight = undefined;
    worker.onmessage = null; worker.onerror = null; worker.terminate();
  }
  function post() {
    if (closed || inFlight !== undefined || !pending) return;
    active = pending; pending = undefined; inFlight = active.id;
    const changed = !sameSheets(sent, active.sheets);
    if (changed) { version++; sent = active.sheets; }
    active.version = version;
    try { worker.postMessage({ id: active.id, version, query: active.query, options: active.options, ...(changed ? { sheets: active.sheets } : {}) }); }
    catch { close(new Error("Search could not start. Try again.")); }
  }
  worker.onmessage = ({ data }) => {
    if (closed || data.id !== inFlight) return;
    inFlight = undefined; const current = active; active = undefined;
    if (current) {
      if (data.version !== current.version) { current.reject(new Error("The search source changed. Search again.")); close(); return; }
      if (data.kind === "error") current.reject(new Error(data.message));
      else current.resolve(data.result);
    }
    post();
  };
  worker.onerror = (event) => { event.preventDefault(); close(new Error("Search could not finish. Try again.")); };
  return {
    search(sheets: readonly SearchSheet[], query: string, options: LiteralSearchOptions = {}): Promise<WorkspaceSearchResult> {
      if (closed) return Promise.reject(new DOMException("Search was closed.", "AbortError"));
      active?.reject(cancelled()); active = undefined; pending?.reject(cancelled());
      return new Promise((resolve, reject) => {
        pending = { id: ++id, sheets, query, options: { matchCase: options.matchCase === true }, resolve, reject }; post();
      });
    },
    close: () => close(),
  };
}
