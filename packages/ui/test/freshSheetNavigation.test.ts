import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
async function workspace() {
  const files = createMemoryFiles({ "a.md": "First", "b.md": "\uFEFF# Old\r\n" });
  const store = createWorkspaceStore({ id: "sample", name: "Notes", tier: "library" }, files);
  await store.load(); return { files, store };
}
it("quick-opens current bytes and flushes the prior draft without scanning unchanged files", async () => {
  const { files, store } = await workspace(); store.edit("Draft kept");
  await files.write("b.md", encodeText("\uFEFF# Current\r\n"));
  await store.flush(); const list = vi.spyOn(files, "list");
  const opened = await store.openSheet("b.md");
  expect(opened.content).toBe("\uFEFF# Current\r\n"); expect(list).not.toHaveBeenCalled();
  expect(store.api.getState().selectedPath).toBe("b.md");
  expect(await store.space.read("a.md")).toBe("Draft kept");
});
it("rejects stale heading offsets while updating metadata and keeping the current sheet selected", async () => {
  const { files, store } = await workspace();
  await files.write("b.md", encodeText("# Different\n"));
  await expect(store.openSheet("b.md", { source: "\uFEFF# Old\r\n", position: 1 })).rejects.toThrow(/changed/i);
  expect(store.api.getState().selectedPath).toBe("a.md");
  expect(store.api.getState().sheets.find((sheet) => sheet.path === "b.md")?.content).toBe("# Different\n");
  expect(await store.space.read("b.md")).toBe("# Different\n");
});
it("keeps unsupported bytes available as a read-only file and refuses heading navigation", async () => {
  const { files, store } = await workspace(); const bytes = new Uint8Array([0xff, 0xfe, 0xfd]);
  await files.write("b.md", bytes); store.setOwned(false);
  const opened = await store.openSheet("b.md"); expect(opened.unsupportedEncoding).toBe(true);
  expect(store.api.getState().selectedPath).toBe("b.md");
  await expect(store.openSheet("b.md", { source: "", position: 0 })).rejects.toThrow(/UTF-8/);
  expect(await files.read("b.md")).toEqual(bytes);
});
it("does not reinterpret a read failure or missing file as a new blank sheet", async () => {
  const { files, store } = await workspace(); const read = files.read;
  vi.spyOn(files, "read").mockImplementation((path) => path === "b.md" ? Promise.reject(new Error("Permission lost")) : read(path));
  await expect(store.openSheet("b.md")).rejects.toThrow("Permission lost");
  expect(store.api.getState().selectedPath).toBe("a.md");
  vi.restoreAllMocks(); await files.remove("b.md");
  await expect(store.openSheet("b.md")).rejects.toThrow(/no longer exists/);
  expect(store.api.getState().selectedPath).toBe("a.md"); expect(await files.read("b.md")).toBeUndefined();
});
it("keeps new typing that arrives while the destination is being read", async () => {
  const { files, store } = await workspace(); const read = files.read;
  let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void; const entered = new Promise<void>((resolve) => { started = resolve; });
  vi.spyOn(files, "read").mockImplementation(async (path) => { if (path === "b.md") { started(); await pending; } return read(path); });
  const opening = store.openSheet("b.md"); await entered; store.edit("New words kept"); release();
  await expect(opening).rejects.toThrow(/changed/);
  expect(store.api.getState().selectedPath).toBe("a.md");
  expect(store.api.getState().sheets.find((sheet) => sheet.path === "a.md")?.content).toBe("New words kept");
  await store.flush(); expect(await store.space.read("a.md")).toBe("New words kept");
});
it("keeps a retained draft visible after ownership is lost instead of replacing it with disk text", async () => {
  const { store, files } = await workspace(); store.edit("Unsaved words kept"); store.setOwned(false);
  await expect(store.openSheet("a.md")).rejects.toThrow(/draft/);
  expect(store.api.getState().sheets.find((sheet) => sheet.path === "a.md")?.content).toBe("Unsaved words kept");
  expect(store.api.getState().selectedPath).toBe("a.md"); expect(await files.read("a.md")).toEqual(encodeText("First"));
});
it("recovers exact BOM and mixed physical endings after editor-style character changes", async () => {
  const files = createMemoryFiles({ "a.md": "\uFEFFa\r\nb\rc\n" });
  const record = { id: "recovery-eol", name: "Notes", tier: "library" } as const;
  const owner = createWorkspaceStore(record, files); owner.setOwned(true); await owner.load();
  const expected = "\uFEFFa!\r\nb\rc\n"; owner.edit(expected, [{ from: 2, to: 2, text: "!" }]);
  const reader = createWorkspaceStore(record, files); await reader.load();
  expect(reader.api.getState().sheets[0]?.content).toBe(expected);
  reader.setOwned(true); await reader.flush(); expect(await reader.space.read("a.md")).toBe(expected);
});
