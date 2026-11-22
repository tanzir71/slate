import { expect, it, vi } from "vitest";
import { nativeStartupSpace, observeNativeFileStartup } from "../src/native/nativeStartupSpace";
import type { NativeLaunchSnapshot } from "../src/native/nativeLaunchSource";
import type { TauriInvoke } from "../src/tauriAutosave";
import { defaultNativeSpace } from "../src/native/nativeSpaces";

it.each(["pending", "started", "applied"])("boots straight into a %s native file's admitted Space before loading the default workspace", async phase => {
  const space = { id: "12345678-1234-4321-9876-123456789abc", name: "Notes", path: "C:\\Notes" };
  const invoke = vi.fn().mockResolvedValueOnce({ revision: 1, current: { id: "host-file", url: "", fileName: "note.md", phase }, waiting: 0, error: null })
    .mockResolvedValueOnce({ space, path: "note.md", url: `slate://open?space=${space.id}&path=note.md` });
  expect(await nativeStartupSpace(invoke as TauriInvoke)).toEqual(space);
  expect(invoke.mock.calls).toEqual([["pending_native_launches", undefined], ["resolve_native_file", { id: "host-file" }]]);
});
it("observes file opens during startup, ignores older snapshots and cleans its listener", async () => {
  let deliver!: (snapshot: NativeLaunchSnapshot) => void, resolve!: (snapshot: NativeLaunchSnapshot) => void;
  const pending = new Promise<NativeLaunchSnapshot>(yes => { resolve = yes; }), receive = vi.fn(), stop = vi.fn();
  const opening = observeNativeFileStartup(receive, { pending: () => pending, listen: async next => { deliver = next; return stop; } });
  await Promise.resolve();
  const snapshot: NativeLaunchSnapshot = { revision: 2, current: { id: "new-file", url: "", phase: "pending", fileName: "note.md" }, waiting: 0, error: null };
  deliver(snapshot);
  resolve({ ...snapshot, revision: 1, current: { ...snapshot.current!, id: "older-file" } });
  const dispose = await opening; expect(receive).toHaveBeenCalledExactlyOnceWith("new-file");
  dispose(); deliver({ ...snapshot, revision: 3 }); expect(stop).toHaveBeenCalledOnce(); expect(receive).toHaveBeenCalledOnce();
});
it("keeps normal startup available while the request UI handles unavailable files or links", async () => {
  for (const ticket of [null, { id: "link", url: "slate://open?path=note.md", phase: "pending" }]) {
    const invoke = vi.fn(async (command: string) => command === "startup_native_space" ? null : ({ revision: 1, current: ticket, waiting: 0, error: null }));
    expect(await nativeStartupSpace(invoke as TauriInvoke)).toEqual(defaultNativeSpace); expect(invoke).toHaveBeenCalledTimes(2);
  }
  const failed = vi.fn().mockRejectedValueOnce(Error("Native queue unavailable")).mockResolvedValueOnce(null);
  expect(await nativeStartupSpace(failed as TauriInvoke)).toEqual(defaultNativeSpace);
});

it("restores a remembered folder even when the link queue fails, and surfaces a disconnected choice", async () => {
  const space = { id: "12345678-1234-4321-9876-123456789abc", name: "Notes", path: "C:\\Notes" };
  const invoke = vi.fn().mockRejectedValueOnce(Error("Native queue unavailable")).mockResolvedValueOnce(space);
  expect(await nativeStartupSpace(invoke as TauriInvoke)).toEqual(space);
  expect(invoke.mock.calls.at(-1)).toEqual(["startup_native_space"]);
  const failed = vi.fn().mockResolvedValueOnce({ revision: 0, current: null, waiting: 0, error: null }).mockRejectedValueOnce(Error("Folder disconnected"));
  await expect(nativeStartupSpace(failed as TauriInvoke)).rejects.toThrow("Folder disconnected");
});
