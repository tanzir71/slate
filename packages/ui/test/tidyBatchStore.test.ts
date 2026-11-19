import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fix } from "@slate/core/tidy";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { prepareTidyBatch } from "@slate/storage/tidy-batch";
import { createWorkspaceStore } from "../src/browser/workspaceStore";

const dirty = (name: string) => `  #   ${name}\n\nWords kept\n`;
const clean = (name: string) => `# ${name}\n\nWords kept\n`;
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
async function setup() {
  const files = createMemoryFiles({ "one.md": dirty("One"), "two.md": dirty("Two") });
  const store = createWorkspaceStore({ id: "batch-store", name: "Writing", tier: "library" }, files);
  store.setOwned(true); await store.load();
  const prepare = (paths = ["one.md", "two.md"], group = "batch-1") => prepareTidyBatch({ space: store.space, paths, group, fix: async (source, configuration) => fix(source, configuration), canWrite: () => store.api.getState().owned });
  return { files, store, prepare };
}

it("refreshes saved batch results and retains one workspace Undo without triggering Tidy on save", async () => {
  const { store, prepare } = await setup();
  const batch = await prepare();
  const noteSaved = vi.fn(); store.subscribeNoteSaved(noteSaved);
  const notify = vi.fn(); store.setOnSaved(notify);
  await store.applyTidyBatch(batch, ["one.md", "two.md"]);
  expect(store.api.getState().sheets.map((sheet) => sheet.content)).toEqual([clean("One"), clean("Two")]);
  expect(store.api.getState().hasTidyBatchUndo).toBe(true);
  expect(notify).toHaveBeenCalledOnce();
  expect(noteSaved).not.toHaveBeenCalled();
  await store.undoTidyBatch();
  expect(store.api.getState().sheets.map((sheet) => sheet.content)).toEqual([dirty("One"), dirty("Two")]);
  expect(store.api.getState().hasTidyBatchUndo).toBe(false);
  expect(noteSaved).not.toHaveBeenCalled();
});

it("keeps batch Undo groups in order after their review dialogs close", async () => {
  const { store, prepare } = await setup();
  await store.applyTidyBatch(await prepare(["one.md"]), ["one.md"]);
  await store.applyTidyBatch(await prepare(["two.md"], "batch-2"), ["two.md"]);
  await store.undoTidyBatch();
  expect(await store.space.read("one.md")).toBe(clean("One"));
  expect(await store.space.read("two.md")).toBe(dirty("Two"));
  expect(store.api.getState().hasTidyBatchUndo).toBe(true);
  await store.undoTidyBatch();
  expect(await store.space.read("one.md")).toBe(dirty("One"));
  expect(store.api.getState().hasTidyBatchUndo).toBe(false);
});

it("flushes a newer draft and refuses to replace it with an old reviewed proposal", async () => {
  const { store, prepare } = await setup();
  const batch = await prepare();
  store.edit("Newer writing\n");
  await expect(store.applyTidyBatch(batch, ["one.md"])).rejects.toThrow("changed");
  expect(await store.space.read("one.md")).toBe("Newer writing\n");
  expect(store.api.getState().hasTidyBatchUndo).toBe(false);
});

it("keeps newer draft words and the original history when a batch Undo is blocked", async () => {
  const { store, prepare } = await setup();
  await store.applyTidyBatch(await prepare(), ["one.md"]);
  store.edit("Writing after Tidy\n");
  await expect(store.undoTidyBatch()).rejects.toThrow("changed");
  expect(await store.space.read("one.md")).toBe("Writing after Tidy\n");
  expect(await store.space.read(".slate/history/batch-1/one.md")).toBe(dirty("One"));
  expect(store.api.getState().hasTidyBatchUndo).toBe(true);
});

it("registers partial work before reporting failure so the saved subset can be undone", async () => {
  const { files, store, prepare } = await setup();
  const batch = await prepare();
  const write = files.write;
  vi.spyOn(files, "write").mockImplementation(async (path, bytes) => { if (path === "two.md") throw new Error("Permission denied"); await write(path, bytes); });
  await expect(store.applyTidyBatch(batch, ["one.md", "two.md"])).rejects.toThrow("Permission denied");
  expect(store.api.getState().hasTidyBatchUndo).toBe(true);
  await store.undoTidyBatch();
  expect(await files.read("one.md")).toEqual(encodeText(dirty("One")));
  expect(await files.read("two.md")).toEqual(encodeText(dirty("Two")));
});

it("keeps completed batch changes and Undo when an optional workspace refresh fails", async () => {
  const { files, store, prepare } = await setup();
  const batch = await prepare();
  vi.spyOn(files, "list").mockRejectedValueOnce(new Error("Folder unavailable"));
  await store.applyTidyBatch(batch, ["one.md"]);
  expect(await store.space.read("one.md")).toBe(clean("One"));
  expect(store.api.getState().hasTidyBatchUndo).toBe(true);
  expect(store.api.getState().notice).toContain("saved");
  await store.undoTidyBatch();
  expect(await store.space.read("one.md")).toBe(dirty("One"));
});
