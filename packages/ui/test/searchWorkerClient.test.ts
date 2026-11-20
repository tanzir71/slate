import { expect, it, vi } from "vitest";
import { createSearchWorkerClient, type SearchWorker } from "../src/search/searchWorkerClient";
import { searchWorkspace, type SearchSheet } from "../src/search/searchResults";
import type { SearchWorkerReply } from "../src/search/searchWorkerProtocol";

const sheets = [{ path: "a.md", content: "Alpha Beta" }];
function fakeWorker(): SearchWorker { return { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null }; }
function reply(worker: SearchWorker, id: number, version = 1, source: readonly SearchSheet[] = sheets, query = "Alpha") {
  worker.onmessage?.(new MessageEvent<SearchWorkerReply>("message", { data: { id, version, kind: "result", result: searchWorkspace(source, query) } }));
}
it("sends source only when changed and matches replies to their request and source version", async () => {
  const worker = fakeWorker(), client = createSearchWorkerClient(worker);
  const first = client.search(sheets, "Alpha"); reply(worker, 999); reply(worker, 1);
  expect((await first).totalMatches).toBe(1);
  const second = client.search(sheets.map((sheet) => ({ ...sheet })), "Beta");
  expect(vi.mocked(worker.postMessage).mock.calls[1]![0]).toMatchObject({ id: 2, version: 1, query: "Beta" });
  expect(vi.mocked(worker.postMessage).mock.calls[1]![0].sheets).toBeUndefined(); reply(worker, 2, 1, sheets, "Beta"); await second;
  const changed = [{ path: "a.md", content: "New source" }], third = client.search(changed, "New");
  expect(vi.mocked(worker.postMessage).mock.calls[2]![0]).toMatchObject({ version: 2, sheets: changed });
  reply(worker, 3, 2, changed, "New"); expect((await third).totalMatches).toBe(1); client.close();
});
it("bounds continuous requests to the active search and latest query, rejecting superseded promises", async () => {
  const worker = fakeWorker(), client = createSearchWorkerClient(worker);
  const outcomes: Promise<unknown>[] = [client.search(sheets, "old").catch((cause: unknown) => cause)];
  for (let index = 0; index < 40; index++) outcomes.push(client.search(sheets, String(index)).catch((cause: unknown) => cause));
  expect(worker.postMessage).toHaveBeenCalledTimes(1); reply(worker, 1);
  expect(worker.postMessage).toHaveBeenCalledTimes(2); expect(vi.mocked(worker.postMessage).mock.calls[1]![0].query).toBe("39");
  reply(worker, 41, 1, sheets, "39"); const values = await Promise.all(outcomes);
  expect(values.slice(0, -1).every((value) => value instanceof DOMException && value.name === "AbortError")).toBe(true);
  expect(values.at(-1)).toMatchObject({ totalMatches: 0 }); client.close();
});
it("captures options and rejects a wrong source version without publishing a stale result", async () => {
  const worker = fakeWorker(), client = createSearchWorkerClient(worker), options = { matchCase: true };
  const pending = client.search(sheets, "alpha", options); options.matchCase = false;
  expect(vi.mocked(worker.postMessage).mock.calls[0]![0].options.matchCase).toBe(true);
  const error = expect(pending).rejects.toThrow(/source changed/); reply(worker, 1, 9); await error;
  expect(worker.terminate).toHaveBeenCalledOnce(); await expect(client.search(sheets, "Alpha")).rejects.toMatchObject({ name: "AbortError" });
});
it("returns a worker-reported error and permits a subsequent request", async () => {
  const worker = fakeWorker(), client = createSearchWorkerClient(worker), pending = client.search(sheets, "Alpha");
  const error = expect(pending).rejects.toThrow("Bad query");
  worker.onmessage?.(new MessageEvent<SearchWorkerReply>("message", { data: { id: 1, version: 1, kind: "error", message: "Bad query" } })); await error;
  const next = client.search(sheets, "Beta"); reply(worker, 2, 1, sheets, "Beta"); expect((await next).totalMatches).toBe(1); client.close();
});
it.each(["post", "worker"])("settles pending work and terminates after a %s failure", async (kind) => {
  const worker = fakeWorker(); if (kind === "post") vi.mocked(worker.postMessage).mockImplementation(() => { throw new Error("Worker unavailable"); });
  const client = createSearchWorkerClient(worker), pending = client.search(sheets, "Alpha");
  const error = expect(pending).rejects.toThrow(/Search could not/);
  if (kind === "worker") worker.onerror?.(new ErrorEvent("error", { cancelable: true })); await error;
  expect(worker.terminate).toHaveBeenCalledOnce(); expect(worker.onmessage).toBeNull(); client.close(); expect(worker.terminate).toHaveBeenCalledOnce();
});
it("rejects both queued and active work on close and ignores later replies", async () => {
  const worker = fakeWorker(), client = createSearchWorkerClient(worker), handler = worker.onmessage;
  const first = client.search(sheets, "Alpha").catch((cause: unknown) => cause), second = client.search(sheets, "Beta").catch((cause: unknown) => cause);
  client.close(); client.close();
  for (const cause of await Promise.all([first, second])) expect(cause).toMatchObject({ name: "AbortError" });
  handler?.(new MessageEvent<SearchWorkerReply>("message", { data: { id: 1, version: 1, kind: "result", result: searchWorkspace(sheets, "Alpha") } }));
  expect(worker.postMessage).toHaveBeenCalledOnce(); expect(worker.terminate).toHaveBeenCalledOnce();
});
