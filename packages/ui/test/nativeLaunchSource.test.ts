import { expect, it, vi } from "vitest";
import { createNativeLaunchSource, type NativeLaunchSnapshot } from "../src/native/nativeLaunchSource";
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
