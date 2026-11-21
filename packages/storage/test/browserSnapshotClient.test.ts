import { expect, it, vi } from "vitest";
import { createDirectorySnapshotReader, type DirectorySnapshotWorker } from "../src/browserSnapshotClient";
import type { BrowserDirectoryHandle } from "../src/browserFiles";
import type { DirectorySnapshotReply, DirectorySnapshotRequest } from "../src/browserSnapshotProtocol";

const root = (name = "Space A") => ({ kind: "directory", name }) as BrowserDirectoryHandle;
const row = (content: string) => [{ path: "note.md", content }];
const tick = () => Promise.resolve();
function fakeWorker() {
  const requests: DirectorySnapshotRequest[] = [];
  const worker: DirectorySnapshotWorker = { onmessage: null, onerror: null, onmessageerror: null,
    postMessage: vi.fn(request => { requests.push(request); }), terminate: vi.fn() };
  const reply = (data: Omit<Extract<DirectorySnapshotReply, { kind: "snapshot" }>, "id"> | Omit<Extract<DirectorySnapshotReply, { kind: "error" }>, "id">) => {
    worker.onmessage?.({ data: { ...data, id: requests.at(-1)!.id } } as MessageEvent<DirectorySnapshotReply>);
  };
  return { worker, requests, reply };
}

it("queues separate fresh reads of the exact root and releases the worker only after draining", async () => {
  const selected = root(), fake = fakeWorker(), fallback = vi.fn(), make = vi.fn(() => fake.worker);
  const read = createDirectorySnapshotReader(selected, fallback, make), first = read(), second = read();
  await tick(); expect(fake.requests).toHaveLength(1); expect(fake.requests[0]!.root).toBe(selected);
  fake.reply({ kind: "snapshot", sheets: row("before external edit") });
  expect(await first).toEqual(row("before external edit"));
  await tick(); expect(fake.requests).toHaveLength(2); expect(fake.requests[1]!.root).toBe(selected);
  expect(fake.worker.terminate).not.toHaveBeenCalled();
  fake.reply({ kind: "snapshot", sheets: row("after external edit") });
  expect(await second).toEqual(row("after external edit"));
  expect(fake.worker.terminate).toHaveBeenCalledOnce(); expect(make).toHaveBeenCalledOnce();
  expect(fallback).not.toHaveBeenCalled(); expect(fake.worker.onmessage).toBeNull();
});

it("separate Spaces retain their own handles and results during overlapping reads", async () => {
  const a = root(), b = root("Space B"), wa = fakeWorker(), wb = fakeWorker();
  const first = createDirectorySnapshotReader(a, vi.fn(), () => wa.worker)();
  const second = createDirectorySnapshotReader(b, vi.fn(), () => wb.worker)();
  await tick(); expect(wa.requests[0]!.root).toBe(a); expect(wb.requests[0]!.root).toBe(b);
  wb.reply({ kind: "snapshot", sheets: row("B") }); wa.reply({ kind: "snapshot", sheets: row("A") });
  expect(await first).toEqual(row("A")); expect(await second).toEqual(row("B"));
});

it("starts a fresh worker after an idle read rather than retaining an old snapshot", async () => {
  const first = fakeWorker(), second = fakeWorker(), make = vi.fn().mockReturnValueOnce(first.worker).mockReturnValueOnce(second.worker);
  const read = createDirectorySnapshotReader(root(), vi.fn(), make), before = read();
  await tick(); first.reply({ kind: "snapshot", sheets: row("before") }); await before;
  const after = read(); await tick(); second.reply({ kind: "snapshot", sheets: row("after") });
  expect(await after).toEqual(row("after")); expect(make).toHaveBeenCalledTimes(2);
  expect(first.worker.terminate).toHaveBeenCalledOnce(); expect(second.worker.terminate).toHaveBeenCalledOnce();
});

it.each(["NotAllowedError", "SecurityError", "NotReadableError", "UnknownError"])("surfaces worker filesystem %s without fallback and permits a later read", async name => {
  const fake = fakeWorker(), fallback = vi.fn(), read = createDirectorySnapshotReader(root(), fallback, () => fake.worker);
  const first = read(), rejected = expect(first).rejects.toMatchObject({ name, message: "Disk error" }), second = read();
  await tick(); fake.reply({ kind: "error", name, message: "Disk error" }); await rejected;
  await tick(); fake.reply({ kind: "snapshot", sheets: row("permission restored") });
  expect(await second).toEqual(row("permission restored")); expect(fallback).not.toHaveBeenCalled();
});

it.each(["unavailable", "constructor", "clone", "error", "messageerror", "malformed"])("falls back to fresh local reads only for %s transport", async failure => {
  const fake = fakeWorker(), fallback = vi.fn().mockResolvedValueOnce(row("local first")).mockResolvedValueOnce(row("local second"));
  if (failure === "clone") fake.worker.postMessage = () => { throw new DOMException("Cannot clone handle", "DataCloneError"); };
  const make = vi.fn(() => { if (failure === "constructor") throw new Error("CSP unavailable"); return failure === "unavailable" ? undefined : fake.worker; });
  const read = createDirectorySnapshotReader(root(), fallback, make), first = read();
  await tick();
  if (failure === "error") fake.worker.onerror?.({ preventDefault() {} } as ErrorEvent);
  if (failure === "messageerror") fake.worker.onmessageerror?.({} as MessageEvent<unknown>);
  if (failure === "malformed") fake.worker.onmessage?.({ data: { id: -1 } } as MessageEvent<DirectorySnapshotReply>);
  expect(await first).toEqual(row("local first")); expect(await read()).toEqual(row("local second"));
  expect(make).toHaveBeenCalledOnce(); expect(fallback).toHaveBeenCalledTimes(2);
  if (!["unavailable", "constructor"].includes(failure)) expect(fake.worker.terminate).toHaveBeenCalledOnce();
});

it("keeps a local fallback filesystem error visible", async () => {
  const error = new DOMException("Denied locally", "NotAllowedError");
  const read = createDirectorySnapshotReader(root(), async () => { throw error; }, () => undefined);
  await expect(read()).rejects.toBe(error);
});
