import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNativeWorkspace, type NativeChange, type NativeLifecycle } from "../src/native/nativeWorkspace";
import { createTauriWorkspaceFiles } from "@slate/storage/tauri-files";
import type { TauriInvoke } from "../src/tauriAutosave";

function setup(initial: Record<string, string> = {}) {
  const disk = new Map(Object.entries(initial).map(([path, value]) => [path, new TextEncoder().encode(value)]));
  let changes: ((event: NativeChange) => void) | undefined;
  let close: ((event: { preventDefault(): void }) => void) | undefined;
  const stop = vi.fn();
  const lifecycle: NativeLifecycle = {
    listen: vi.fn(async (callback) => { changes = callback; return stop; }),
    watchStatus: vi.fn(async () => []),
    onClose: vi.fn(async (callback) => { close = callback; return stop; }),
    destroy: vi.fn(async () => undefined),
  };
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    const path = String(args?.path);
    if (command === "list_workspace_files") return [...disk.keys()].filter((key) => args?.includePrivate || !key.startsWith(".slate/"));
    if (command === "read_workspace_file") return disk.has(path) ? Array.from(disk.get(path)!) : null;
    if (command === "create_workspace_file") {
      if (disk.has(path)) return false;
      disk.set(path, new Uint8Array(args?.bytes as number[])); return true;
    }
    if (command === "save_workspace_file") {
      const current = disk.get(path), base = args?.baseBytes as number[] | null;
      const same = current ? base !== null && current.toString() === base.toString() : base === null;
      const target = same ? path : path + ".conflict.md";
      disk.set(target, new Uint8Array(args?.bytes as number[]));
      return { status: same ? "written" : "conflict-copy", path: target };
    }
    throw new Error("Unexpected command " + command);
  });
  const files = createTauriWorkspaceFiles({ invoke: invoke as TauriInvoke });
  const global = createTauriWorkspaceFiles({ invoke: invoke as TauriInvoke, scope: "global" });
  return { disk, lifecycle, invoke, stop, session: createNativeWorkspace(lifecycle, files, global), change: (event: NativeChange) => changes!(event), close: () => { const preventDefault = vi.fn(); close!({ preventDefault }); return preventDefault; } };
}

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

it("opens only real disk notes, preserves raw BOM/CRLF, and reopens a saved edit", async () => {
  const { session, disk, lifecycle, invoke } = setup({ "Inbox/real.md": "\uFEFF# Real\r\n" });
  await session.open();
  expect(session.store.api.getState().sheets).toEqual([{ path: "Inbox/real.md", content: "\uFEFF# Real\r\n" }]);
  session.store.edit("My words\r\n");
  await session.store.flush();
  expect(new TextDecoder().decode(disk.get("Inbox/real.md"))).toBe("My words\r\n");
  const reopened = createNativeWorkspace(lifecycle, createTauriWorkspaceFiles({ invoke: invoke as TauriInvoke }));
  await reopened.open();
  expect(reopened.store.api.getState().sheets).toEqual([{ path: "Inbox/real.md", content: "My words\r\n" }]);
  expect(reopened.store.api.getState().owned).toBe(true);
});

it("opens an empty real Space without creating samples or defaults", async () => {
  const { session, invoke, disk } = setup();
  await session.open();
  expect(session.store.api.getState().sheets).toEqual([]);
  expect(disk.size).toBe(0);
  expect(invoke.mock.calls.every(([command]) => command.startsWith("read_") || command.startsWith("list_"))).toBe(true);
});

it("propagates startup read failures without a seeded workspace fallback", async () => {
  const { session, invoke, disk } = setup({ "note.md": "Words" });
  invoke.mockRejectedValueOnce({ kind: "permission", message: "Access denied" });
  await expect(session.open()).rejects.toThrow("Access denied");
  expect(session.store.api.getState().sheets).toEqual([]);
  expect(disk.size).toBe(1);
});

it("keeps a dirty draft and the external revision when a watcher refresh races autosave", async () => {
  const { session, disk, change } = setup({ "note.md": "Original" });
  await session.open();
  const refresh = vi.fn(() => { void session.store.refresh(); });
  const stop = await session.runtime.observe(refresh, vi.fn());
  session.store.edit("My draft");
  disk.set("note.md", new TextEncoder().encode("External"));
  change({ scope: "space", error: null });
  await vi.advanceTimersByTimeAsync(25);
  expect(session.store.api.getState().sheets[0]?.content).toBe("My draft");
  await session.store.flush();
  expect(new TextDecoder().decode(disk.get("note.md"))).toBe("External");
  expect([...disk.values()].map((bytes) => new TextDecoder().decode(bytes))).toContain("My draft");
  stop();
});

it("refreshes the load/listen gap, reports watch failure, and cancels pending callbacks on disposal", async () => {
  const { session, lifecycle, change, stop } = setup();
  vi.mocked(lifecycle.watchStatus).mockResolvedValueOnce(["Watch unavailable"]);
  const refresh = vi.fn(), failed = vi.fn();
  const dispose = await session.runtime.observe(refresh, failed);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(failed.mock.calls[0]?.[0]).toEqual(new Error("Watch unavailable"));
  change({ scope: "global", error: "Disconnected" });
  expect(failed).toHaveBeenCalledTimes(2);
  dispose();
  await vi.advanceTimersByTimeAsync(100);
  expect(stop).toHaveBeenCalledOnce();
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("waits for pending disk writes before closing and coalesces duplicate close requests", async () => {
  const { session, lifecycle, close, disk } = setup({ "note.md": "Original" });
  await session.open();
  await session.protectClose();
  session.store.edit("Saved before closing");
  expect(close()).toHaveBeenCalledOnce();
  close();
  expect(lifecycle.destroy).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(0);
  expect(new TextDecoder().decode(disk.get("note.md"))).toBe("Saved before closing");
  expect(lifecycle.destroy).toHaveBeenCalledOnce();
});

it("keeps the window and draft open after a failed close flush, allowing retry", async () => {
  const { session, lifecycle, close, invoke } = setup({ "note.md": "Original" });
  await session.open();
  await session.protectClose();
  session.store.edit("Retained draft");
  invoke.mockRejectedValueOnce({ kind: "permission", message: "Disk is read-only" });
  close();
  await vi.advanceTimersByTimeAsync(0);
  expect(lifecycle.destroy).not.toHaveBeenCalled();
  expect(session.store.api.getState()).toMatchObject({ error: "Disk is read-only", saveState: "Unsaved" });
  expect(session.store.api.getState().sheets[0]?.content).toBe("Retained draft");
  close();
  await vi.advanceTimersByTimeAsync(0);
  expect(lifecycle.destroy).toHaveBeenCalledOnce();
});

it("reads global snippets from native storage without opening browser OPFS", async () => {
  const { session, invoke } = setup({ "global/snippets.json": '{"version":1,"snippets":[]}' });
  const file = await session.runtime.openGlobalSnippets!();
  expect((await file.read()).status).toBe("valid");
  expect(invoke).toHaveBeenCalledWith("read_workspace_file", { scope: "global", path: "global/snippets.json" });
});
