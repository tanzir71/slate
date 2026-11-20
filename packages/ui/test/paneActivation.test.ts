import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
async function setup() {
  const files = createMemoryFiles({ "a.md": "\uFEFFAlpha\r\n", "b.md": "Beta", "c.md": "Gamma" });
  const store = createWorkspaceStore({ id: "sample", name: "Notes", tier: "library" }, files); await store.load();
  return { files, store };
}
it("activates loaded panes immediately without IO and retains each file's pending draft", async () => {
  const { files, store } = await setup(); store.edit("\uFEFFAlpha draft\r\n");
  const read = vi.spyOn(files, "read"), write = vi.spyOn(files, "write");
  expect(store.activateSheet("b.md")).toBe(true); expect(store.api.getState().selectedPath).toBe("b.md");
  expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  store.edit("Beta draft"); expect(store.hasDraft("a.md")).toBe(true); expect(store.hasDraft("b.md")).toBe(true);
  expect(store.activateSheet("a.md")).toBe(true); await store.flush();
  expect(await files.read("a.md")).toEqual(encodeText("\uFEFFAlpha draft\r\n"));
  expect(await files.read("b.md")).toEqual(encodeText("Beta draft"));
  expect(store.hasDraft("a.md")).toBe(false); expect(store.hasDraft("b.md")).toBe(false);
});
it("rejects unknown/private paths and keeps same-pane activation and pending cursor stable", async () => {
  const { store } = await setup(); store.api.setState({ initialCursor: { path: "a.md", position: 3 } });
  const before = store.api.getState(), changed = vi.fn(); store.api.subscribe(changed);
  for (const path of ["missing.md", "../a.md", ".slate/history/a.md", ".git/a.md"]) expect(store.activateSheet(path)).toBe(false);
  expect(store.activateSheet("a.md")).toBe(true); expect(store.api.getState()).toBe(before); expect(changed).not.toHaveBeenCalled();
  expect(store.activateSheet("b.md")).toBe(true); expect(store.api.getState().initialCursor).toBeUndefined();
});
it("keeps an explicitly closed last tab empty across disk refreshes, then accepts later navigation", async () => {
  const { files, store } = await setup(); expect(store.activateSheet("")).toBe(true);
  await store.refresh(); expect(store.api.getState().selectedPath).toBe("");
  await files.write("d.md", encodeText("Delta")); await store.refresh(); expect(store.api.getState().selectedPath).toBe("");
  await store.select("b.md"); await store.refresh(); expect(store.api.getState().selectedPath).toBe("b.md");
  expect(await files.read("a.md")).toEqual(encodeText("\uFEFFAlpha\r\n"));
});
it("lets readers activate supported and unsupported files without enabling writes", async () => {
  const { files, store } = await setup(), bytes = new Uint8Array([0xff]);
  await files.write("bad.md", bytes); await store.refresh(); store.setOwned(false);
  expect(store.activateSheet("b.md")).toBe(true); expect(store.activateSheet("bad.md")).toBe(true);
  store.edit("No conversion"); await store.flush(); expect(await files.read("bad.md")).toEqual(bytes);
  expect(store.hasDraft("bad.md")).toBe(false);
});
it("invalidates a pending destination read even when pane focus returns to its original file", async () => {
  const { files, store } = await setup(); await store.select("b.md"); const read = files.read;
  let release!: () => void, entered!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; }), started = new Promise<void>((resolve) => { entered = resolve; });
  vi.spyOn(files, "read").mockImplementation(async (path) => { if (path === "a.md") { entered(); await pending; } return read(path); });
  const opening = store.openSheet("a.md"); await started;
  store.activateSheet("c.md"); store.activateSheet("b.md"); release();
  await expect(opening).rejects.toThrow(/changed/); expect(store.api.getState().selectedPath).toBe("b.md");
});
