import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";
import { parseSheet } from "@slate/core";

const record = { id: "test-library", name: "Writing", tier: "library" } as const;
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe("persistent workspace store", () => {
  it("creates an unresolved wiki target once, keeps the source bytes and follows it on later clicks", async () => {
    const original = "# Original\n\nSee [[New idea|alias]].\n";
    const files = createMemoryFiles({ "source.md": original, "Inbox/New idea.md": "# A different title\n\nExisting words." });
    const store = createWorkspaceStore(record, files);
    store.setOwned(true);
    await store.load();
    await store.select("source.md");
    const link = { target: "New idea", display: "alias", targetId: undefined };
    await Promise.all([store.followWikiLink(link), store.followWikiLink(link)]);
    const path = store.api.getState().selectedPath;
    expect(path).toBe("Inbox/New idea (1).md");
    expect(parseSheet((await store.space.read(path))!, path).title).toBe("New idea");
    expect(await store.space.read("source.md")).toBe(original);
    expect(await store.space.read("Inbox/New idea.md")).toContain("Existing words.");
    expect(await files.list()).toHaveLength(3);
  });

  it("preserves stable wiki IDs, sanitizes filenames and refuses creation from a read-only tab", async () => {
    const files = createMemoryFiles();
    const store = createWorkspaceStore(record, files);
    store.setOwned(true);
    const id = "01J22222222222222222222222";
    await store.followWikiLink({ target: id, targetId: id, display: "CON" });
    expect(store.api.getState().selectedPath).toBe("Inbox/_CON.md");
    const content = await store.space.read("Inbox/_CON.md");
    expect(parseSheet(content!, "Inbox/_CON.md").id).toBe(id);
    await store.followWikiLink({ target: "../Outside", targetId: undefined, display: "../Outside" });
    expect(store.api.getState().selectedPath).toBe("Inbox/..-Outside.md");
    store.setOwned(false);
    await expect(store.followWikiLink({ target: "Missing", display: "Missing", targetId: undefined })).rejects.toThrow("read-only");
    await store.followWikiLink({ target: id, targetId: id, display: "renamed" });
    expect(store.api.getState().selectedPath).toBe("Inbox/_CON.md");
    expect(await files.list()).toHaveLength(2);
  });
  it("leaves a writer's recovery journal untouched when a read-only tab flushes", async () => {
    const files = createMemoryFiles({ "note.md": "saved base" });
    const owner = createWorkspaceStore(record, files);
    owner.setOwned(true);
    await owner.load();
    owner.edit("writer's unsaved words");
    const reader = createWorkspaceStore(record, files);
    await reader.load();
    const journal = localStorage.getItem(`slate.recovery.${record.id}`);
    await reader.flush();
    expect(await reader.space.read("note.md")).toBe("saved base");
    expect(localStorage.getItem(`slate.recovery.${record.id}`)).toBe(journal);
  });

  it("takes over the latest recovery draft after the previous writer disappears", async () => {
    const files = createMemoryFiles({ "note.md": "saved base" });
    const owner = createWorkspaceStore(record, files);
    owner.setOwned(true);
    await owner.load();
    owner.edit("early draft");
    const reader = createWorkspaceStore(record, files);
    await reader.load();
    owner.edit("latest words before the writer disappeared");
    reader.setOwned(true);
    expect(reader.api.getState().sheets[0]?.content).toBe("latest words before the writer disappeared");
    await reader.refresh();
    await reader.flush();
    expect(await reader.space.read("note.md")).toBe("latest words before the writer disappeared");
  });

  it("drops a reader's stale recovery snapshot after the writer has already saved it", async () => {
    const files = createMemoryFiles({ "note.md": "saved base" });
    const owner = createWorkspaceStore(record, files);
    owner.setOwned(true);
    await owner.load();
    owner.edit("early draft");
    const reader = createWorkspaceStore(record, files);
    await reader.load();
    owner.edit("latest saved words");
    await owner.flush();
    reader.setOwned(true);
    await reader.refresh();
    await reader.flush();
    expect(await reader.space.sheets()).toEqual([{ path: "note.md", content: "latest saved words" }]);
  });

  it("restores the last selected file when opening a Space without a sheet URL", async () => {
    const files = createMemoryFiles({ "A.md": "First", "B.md": "Last selected" });
    localStorage.setItem(`slate.last-sheet.${record.id}`, "B.md");
    const store = createWorkspaceStore(record, files);
    await store.load();
    expect(store.api.getState().selectedPath).toBe("B.md");
    await files.remove("B.md");
    const reopened = createWorkspaceStore(record, files);
    await reopened.load();
    expect(reopened.api.getState().selectedPath).toBe("A.md");
  });

  it("reopens saved files and recovers a draft that was not flushed before closing", async () => {
    const files = createMemoryFiles({ "Inbox/note.md": "original" });
    const first = createWorkspaceStore(record, files);
    first.setOwned(true);
    await first.load();
    first.edit("my unsaved words");
    expect(await first.space.read("Inbox/note.md")).toBe("original");
    const reopened = createWorkspaceStore(record, files);
    reopened.setOwned(true);
    await reopened.load();
    expect(reopened.api.getState().sheets[0]?.content).toBe("my unsaved words");
    await reopened.flush();
    expect(await reopened.space.read("Inbox/note.md")).toBe("my unsaved words");
    expect(localStorage.getItem("slate.recovery.test-library")).toBeNull();
  });

  it("keeps a recovered draft as a conflict copy when the disk changed", async () => {
    const files = createMemoryFiles({ "note.md": "base" });
    const first = createWorkspaceStore(record, files);
    first.setOwned(true);
    await first.load();
    first.edit("local words");
    await files.write("note.md", encodeText("external words"));
    const reopened = createWorkspaceStore(record, files);
    reopened.setOwned(true);
    await reopened.load();
    await reopened.flush();
    expect(await reopened.space.read("note.md")).toBe("external words");
    expect(reopened.api.getState().selectedPath).toContain("conflicted copy");
    expect(await reopened.space.read(reopened.api.getState().selectedPath)).toBe("local words");
  });

  it("keeps an edit made while the previous version is writing", async () => {
    const files = createMemoryFiles({ "note.md": "base" });
    const originalWrite = files.write;
    let finishWrite: (() => void) | undefined;
    files.write = async (path, bytes) => {
      await new Promise<void>((resolve) => { finishWrite = resolve; });
      files.write = originalWrite;
      await originalWrite(path, bytes);
    };
    const store = createWorkspaceStore(record, files);
    store.setOwned(true);
    await store.load();
    store.edit("first");
    const save = store.flush();
    await vi.waitFor(() => expect(finishWrite).toBeDefined());
    store.edit("second");
    finishWrite!();
    await save;
    expect(await store.space.read("note.md")).toBe("second");
    expect(store.api.getState().saveState).toBe("Saved");
  });

  it("retains the draft and shows an error when the file write fails", async () => {
    const files = createMemoryFiles({ "note.md": "base" });
    const store = createWorkspaceStore(record, files);
    store.setOwned(true);
    await store.load();
    store.edit("keep my words");
    files.write = async () => { throw new Error("Quota exceeded"); };
    await expect(store.flush()).rejects.toThrow("Quota exceeded");
    expect(store.api.getState().sheets[0]?.content).toBe("keep my words");
    expect(store.api.getState().saveState).toBe("Unsaved");
    expect(store.api.getState().error).toContain("Quota exceeded");
    expect(localStorage.getItem("slate.recovery.test-library")).toContain("keep my words");
  });
});
