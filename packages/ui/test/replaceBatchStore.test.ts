import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { prepareReplaceBatch } from "@slate/storage/replace-batch";
import { createWorkspaceStore } from "../src/browser/workspaceStore";

const original = "\uFEFF# Alpha\r\n\r\nAlpha words kept.\r\n";
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
async function setup() {
  const files = createMemoryFiles({ "a.md": original, "b.md": "Alpha in Beta\n" });
  const store = createWorkspaceStore({ id: "sample", name: "Notes", tier: "library" }, files); await store.load();
  const prepare = (paths = ["a.md", "b.md"], group = "replace-1") => prepareReplaceBatch({ space: store.space, paths, query: "Alpha", replacement: "New", group, canWrite: () => store.api.getState().owned });
  return { files, store, prepare };
}
it("updates saved source and keeps workspace Undo after closing a preview without triggering save formatting", async () => {
  const { files, store, prepare } = await setup(); const saved = vi.fn(); store.subscribeNoteSaved(saved);
  await store.applyReplaceBatch(await prepare(), ["a.md"]);
  expect(store.api.getState().sheets.find((sheet) => sheet.path === "a.md")?.content).toBe(original.replaceAll("Alpha", "New"));
  expect(store.api.getState().hasReplaceBatchUndo).toBe(true); expect(saved).not.toHaveBeenCalled();
  expect(await files.read("b.md")).toEqual(encodeText("Alpha in Beta\n"));
  await store.undoReplaceBatch(); expect(await files.read("a.md")).toEqual(encodeText(original));
  expect(store.api.getState().hasReplaceBatchUndo).toBe(false); expect(saved).not.toHaveBeenCalled();
});
it("keeps replacement Undo groups in last-applied order", async () => {
  const { files, store, prepare } = await setup();
  await store.applyReplaceBatch(await prepare(["a.md"]), ["a.md"]);
  await store.applyReplaceBatch(await prepare(["b.md"], "replace-2"), ["b.md"]);
  await store.undoReplaceBatch(); expect(await files.read("b.md")).toEqual(encodeText("Alpha in Beta\n"));
  expect(store.api.getState().hasReplaceBatchUndo).toBe(true);
  await store.undoReplaceBatch(); expect(await files.read("a.md")).toEqual(encodeText(original));
  expect(store.api.getState().hasReplaceBatchUndo).toBe(false);
});
it("flushes retained drafts before Apply and rejects the obsolete preview", async () => {
  const { files, store, prepare } = await setup(); const preview = await prepare(); store.edit("Later draft kept");
  await expect(store.applyReplaceBatch(preview, ["a.md"])).rejects.toThrow(/changed/);
  expect(await files.read("a.md")).toEqual(encodeText("Later draft kept"));
  expect(store.api.getState().hasReplaceBatchUndo).toBe(false);
});
it("keeps newer typing and exact originals when Undo cannot replace the current file", async () => {
  const { files, store, prepare } = await setup(); await store.applyReplaceBatch(await prepare(), ["a.md"]);
  store.edit("Words after replacement"); await expect(store.undoReplaceBatch()).rejects.toThrow(/changed/);
  expect(await files.read("a.md")).toEqual(encodeText("Words after replacement"));
  expect(await files.read(".slate/history/replace-1/a.md")).toEqual(encodeText(original));
  expect(store.api.getState().hasReplaceBatchUndo).toBe(true);
});
it("registers a successful subset before reporting failure so it remains undoable", async () => {
  const { files, store, prepare } = await setup(); const preview = await prepare(), write = files.write;
  vi.spyOn(files, "write").mockImplementation((path, bytes) => path === "b.md" ? Promise.reject(new Error("Permission lost")) : write(path, bytes));
  await expect(store.applyReplaceBatch(preview, ["a.md", "b.md"])).rejects.toThrow("Permission lost");
  expect(store.api.getState().hasReplaceBatchUndo).toBe(true); await store.undoReplaceBatch();
  expect(await files.read("a.md")).toEqual(encodeText(original)); expect(await files.read("b.md")).toEqual(encodeText("Alpha in Beta\n"));
});
it("retains completed writes and Undo when refreshing the workspace is temporarily unavailable", async () => {
  const { files, store, prepare } = await setup(); const preview = await prepare();
  vi.spyOn(files, "list").mockRejectedValueOnce(new Error("Folder unavailable"));
  await store.applyReplaceBatch(preview, ["a.md"]);
  expect(await files.read("a.md")).toEqual(encodeText(original.replaceAll("Alpha", "New")));
  expect(store.api.getState()).toMatchObject({ hasReplaceBatchUndo: true, notice: expect.stringContaining("saved") });
  await store.undoReplaceBatch(); expect(await files.read("a.md")).toEqual(encodeText(original));
});
