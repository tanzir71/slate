import { expect, it, vi } from "vitest";
import { createNativeLaunchSource, createNativeLaunchWork, type NativeLaunchSnapshot } from "../src/native/nativeLaunchSource";
import type { TauriInvoke } from "../src/tauriAutosave";

const empty: NativeLaunchSnapshot = { revision: 0, current: null, waiting: 0, error: null };
it("uses only narrow request-ID commands and preserves native failures", async () => {
  const invoke = vi.fn(async (_command: string, _args?: Record<string, unknown>): Promise<unknown> => empty);
  const source = createNativeLaunchSource(invoke as TauriInvoke, vi.fn());
  await source.pending(); await source.bind("id", "space"); await source.begin("id", "claim"); await source.applied("id", "claim");
  await source.review("id"); await source.complete("id"); await source.next();
  expect(invoke.mock.calls).toEqual([
    ["pending_native_launches", undefined], ["bind_native_launch", { id: "id", spaceId: "space" }], ["begin_native_launch", { id: "id", claim: "claim" }], ["apply_native_launch", { id: "id", claim: "claim" }],
    ["review_native_launch", { id: "id" }], ["complete_native_launch", { id: "id" }], ["next_native_launch", undefined],
  ]);
  invoke.mockRejectedValueOnce({ kind: "io", message: "Request could not be finished" });
  await expect(source.complete("id")).rejects.toThrow("Request could not be finished");
});
it.each([null, {}, { ...empty, revision: -1 }, { ...empty, waiting: 0.5 }, { ...empty, error: 123 }, { ...empty, current: undefined }, { ...empty, current: { id: "", url: "slate://new", phase: "pending" } }, { ...empty, current: { id: "id", url: "slate://new", phase: "other" } }, { ...empty, current: { id: "id", url: "slate://new", phase: "pending", spaceId: "" } }])("rejects malformed queue snapshot %j", async value => {
  const source = createNativeLaunchSource(vi.fn(async () => value) as TauriInvoke, vi.fn());
  await expect(source.pending()).rejects.toThrow("Invalid desktop link response");
});
it("validates live events without replacing an active request with malformed data", async () => {
  let deliver!: (value: unknown) => void;
  const stop = vi.fn(), source = createNativeLaunchSource(vi.fn(), async receive => { deliver = receive; return stop; });
  const receive = vi.fn(), failed = vi.fn(), dispose = await source.listen(receive, failed);
  const snapshot = { ...empty, revision: 1, current: { id: "id", url: "slate://new", phase: "pending" } };
  deliver(snapshot); deliver({ ...snapshot, current: { ...snapshot.current, phase: "bad" } });
  expect(receive).toHaveBeenCalledExactlyOnceWith(snapshot); expect(failed).toHaveBeenCalledOnce(); dispose(); expect(stop).toHaveBeenCalledOnce();
});
it("waits for a confirmed action before closing and blocks new work until resumed", async () => {
  const source = createNativeLaunchSource(vi.fn(), vi.fn());
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  const work = vi.fn(async () => held), active = source.run(work), stopped = vi.fn();
  const quiesced = source.quiesce().then(resume => { stopped(); return resume; });
  await Promise.resolve(); expect(stopped).not.toHaveBeenCalled();
  await expect(source.run(vi.fn())).rejects.toThrow("Slate is closing");
  release(); await active; const resume = await quiesced; expect(stopped).toHaveBeenCalledOnce();
  resume(); const next = vi.fn(async () => {}); await source.run(next); expect(next).toHaveBeenCalledOnce();
});
it("releases the close barrier after a failed action so the window can stay open and retry", async () => {
  const source = createNativeLaunchSource(vi.fn(), vi.fn());
  const failed = source.run(async () => { throw Error("Saving failed"); });
  const quiesced = source.quiesce();
  await expect(failed).rejects.toThrow("Saving failed"); await expect(quiesced).rejects.toThrow("Saving failed");
  const next = vi.fn(async () => {}); await source.run(next); expect(next).toHaveBeenCalledOnce();
});

it("resolves only a host ticket ID and validates the admitted Space and relative file action", async () => {
  const space = { id: "12345678-1234-4321-9876-123456789abc", name: "Notes", path: "C:\\Notes" };
  const reply = { space, path: "Notebook/文# %.MD", url: `slate://open?space=${space.id}&path=Notebook%2F%E6%96%87%23%20%25.MD` };
  const invoke = vi.fn(async () => reply);
  const source = createNativeLaunchSource(invoke as TauriInvoke, vi.fn());
  expect(await source.resolveFile("host-ticket")).toEqual(reply);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("resolve_native_file", { id: "host-ticket" });
  for (const invalid of [null, { ...reply, path: undefined }, { ...reply, url: "slate://open?path=../outside.md" },
    { ...reply, url: "slate://new?text=no" }, { ...reply, url: "slate://open?space=other&path=note.md" },
    { ...reply, space: { ...space, path: "relative" } }, { ...reply, path: "Different.md" },
    { ...reply, url: reply.url + "&path=" + encodeURIComponent(reply.path) },
    { ...reply, url: reply.url.replace("slate:", "https:") }]) {
    invoke.mockResolvedValueOnce(invalid as typeof reply);
    await expect(source.resolveFile("host-ticket")).rejects.toThrow();
  }
});

it("keeps existing file paths exact while rejecting unsafe or private host responses", async () => {
  const space = { id: "native-default", name: "Slate", path: null };
  const invoke = vi.fn(), source = createNativeLaunchSource(invoke as TauriInvoke, vi.fn());
  for (const path of [" leading note.MD", "Notebook/ 文 # %.md"]) {
    const reply = { space, path, url: "slate://open?" + new URLSearchParams({ space: space.id, path }) };
    invoke.mockResolvedValueOnce(reply); expect(await source.resolveFile("file")).toEqual(reply);
  }
  for (const path of ["../outside.md", "/absolute.md", "Notebook\\note.md", ".slate/note.md", "Notebook/.GIT/note.md", "note.txt", "bad\u0000.md"]) {
    invoke.mockResolvedValueOnce({ space, path, url: "slate://open?" + new URLSearchParams({ space: space.id, path }) });
    await expect(source.resolveFile("file")).rejects.toThrow();
  }
});

it("a Close in the new Space waits for the old Space's file-switch task and retains its result", async () => {
  const work = createNativeLaunchWork();
  const first = createNativeLaunchSource(vi.fn(), vi.fn(), work), second = createNativeLaunchSource(vi.fn(), vi.fn(), work);
  let release!: (value: string) => void;
  const held = new Promise<string>(yes => { release = yes; });
  const opening = first.run(() => held), closed = vi.fn();
  const close = second.quiesce().then(resume => { closed(); return resume; });
  await Promise.resolve(); expect(closed).not.toHaveBeenCalled();
  await expect(first.run(async () => "must wait")).rejects.toThrow("Slate is closing");
  release("original file"); expect(await opening).toBe("original file");
  const resume = await close; expect(closed).toHaveBeenCalledOnce(); resume();
  expect(await second.run(async () => 42)).toBe(42);
});
