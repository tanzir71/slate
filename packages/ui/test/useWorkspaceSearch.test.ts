import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWorkspaceSearch } from "../src/search/useWorkspaceSearch";
import type { SearchWorker } from "../src/search/searchWorkerClient";
import type { SearchWorkerReply } from "../src/search/searchWorkerProtocol";
import { searchWorkspace } from "../src/search/searchResults";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const sheets = [{ path: "a.md", content: "Alpha Beta" }];
let root: Root, host: HTMLDivElement, workers: SearchWorker[], current: ReturnType<typeof useWorkspaceSearch>;
function Harness({ query, retry = 0 }: { query: string; retry?: number }) { current = useWorkspaceSearch(sheets, query, false, retry); return null; }
beforeEach(() => {
  vi.useFakeTimers(); workers = []; host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("Worker", class implements SearchWorker {
    postMessage = vi.fn(); terminate = vi.fn();
    onmessage: SearchWorker["onmessage"] = null; onerror: SearchWorker["onerror"] = null;
    constructor() { workers.push(this); }
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function render(query: string, retry = 0) { await act(async () => root.render(createElement(Harness, { query, retry }))); }
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(150); }); }
async function reply(worker: SearchWorker, id: number, query: string) {
  await act(async () => worker.onmessage?.(new MessageEvent<SearchWorkerReply>("message", { data: { id, version: 1, kind: "result", result: searchWorkspace(sheets, query) } })));
}
it("debounces queries, suppresses old replies and retains the exact source snapshot for a result", async () => {
  await render("Alpha"); expect(workers).toHaveLength(0); expect(current.pending).toBe(true); await tick();
  await render("Beta"); await reply(workers[0]!, 1, "Alpha"); expect(current.result).toBeUndefined();
  await tick(); await reply(workers[0]!, 2, "Beta");
  expect(current.result?.totalMatches).toBe(1); expect(current.sources?.get("a.md")).toBe("Alpha Beta"); expect(current.pending).toBe(false);
  expect(vi.mocked(workers[0]!.postMessage).mock.calls[1]![0].sheets).toBeUndefined();
});
it("recreates a failed worker even when its old query effect has already been cleaned up", async () => {
  await render("Alpha"); await tick(); await render("Beta");
  await act(async () => workers[0]!.onerror?.(new ErrorEvent("error", { cancelable: true })));
  await tick(); expect(workers).toHaveLength(2); await reply(workers[1]!, 1, "Beta");
  expect(current.result?.totalMatches).toBe(1); expect(current.pending).toBe(false); expect(current.error).toBeUndefined();
});
it("shows a current worker failure and starts a fresh worker for Retry", async () => {
  await render("Alpha"); await tick(); await act(async () => workers[0]!.onerror?.(new ErrorEvent("error", { cancelable: true })));
  expect(current.error).toMatch(/Search could not/); expect(current.pending).toBe(false);
  await render("Alpha", 1); await tick(); expect(workers).toHaveLength(2); await reply(workers[1]!, 1, "Alpha");
  expect(current.error).toBeUndefined(); expect(current.result?.totalMatches).toBe(1);
});
it("does no work for a blank query and cancels a debounce before creating a worker", async () => {
  await render(""); await tick(); expect(workers).toHaveLength(0); expect(current.pending).toBe(false);
  await render("Alpha"); await render(""); await tick(); expect(workers).toHaveLength(0);
});
