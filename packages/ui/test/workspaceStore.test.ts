import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";
import { parseSheet } from "@slate/core";

const record = { id: "test-library", name: "Writing", tier: "library" } as const;
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe("persistent workspace store", () => {
  it("keeps new recovery, older-app recovery and externally saved words as separate files", async () => {
    const files = createMemoryFiles({ "note.md": "original" });
    const owner = createWorkspaceStore(record, files);
    owner.setOwned(true);
    await owner.load();
    owner.edit("new app unsaved", [{ from: 0, to: 8, text: "new app unsaved" }]);
    await files.write("note.md", encodeText("older app saved"));
    localStorage.setItem("slate.recovery.test-library", JSON.stringify({ "note.md": { content: "older app unsaved", baseContent: "older app saved" } }));
    const reopened = createWorkspaceStore(record, files);
    reopened.setOwned(true);
    await reopened.load();
    await reopened.flush();
    expect((await reopened.space.sheets()).map((sheet) => sheet.content).sort()).toEqual(["new app unsaved", "older app saved", "older app unsaved"]);
    expect(localStorage.getItem("slate.recovery.test-library")).toBeNull();
    expect(localStorage.getItem("slate.recovery-v2.test-library")).toBeNull();
  });
  it("keeps the volatile sample editable when browser recovery storage is unavailable", async () => {
    const files = createMemoryFiles({ "sample.md": "Sample words" });
    const blocked = vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("Unavailable", "SecurityError"); });
    try {
      const store = createWorkspaceStore({ id: "sample", name: "Sample", tier: "library" }, files);
      await store.load();
      store.edit("My sample words", [{ from: 0, to: 6, text: "My sample" }]);
      await store.flush();
      expect(await store.space.read("sample.md")).toBe("My sample words");
    } finally { blocked.mockRestore(); }
  });
  it("recovers compact editor changes from a CRLF source and preserves an external edit as a conflict", async () => {
    const original = "alpha\r\nbeta\r\n";
    const files = createMemoryFiles({ "note.md": original });
    const owner = createWorkspaceStore(record, files);
    owner.setOwned(true);
    await owner.load();
    owner.edit("alpha!\nbeta\n", [{ from: 5, to: 5, text: "!" }]);
    owner.edit("alpha!!\nbeta\n", [{ from: 6, to: 6, text: "!" }]);
    expect(await owner.space.read("note.md")).toBe(original);
    await files.write("note.md", encodeText("external words"));
    const reopened = createWorkspaceStore(record, files);
    reopened.setOwned(true);
    await reopened.load();
    expect(reopened.api.getState().sheets[0]?.content).toBe("alpha!!\nbeta\n");
    await reopened.flush();
    expect(await reopened.space.read("note.md")).toBe("external words");
    expect(await reopened.space.read(reopened.api.getState().selectedPath)).toBe("alpha!!\nbeta\n");
    expect(localStorage.getItem("slate.recovery-v2.test-library")).toBeNull();
  });
  it("persists pins/density alongside files, preserves unknown preferences and follows pins through moves", async () => {
    const files = createMemoryFiles({ "note.md": "words", ".slate/view.json": JSON.stringify({ version: 1, custom: { keep: true } }) });
    const store = createWorkspaceStore(record, files);
    store.setOwned(true);
    await store.load();
    await Promise.all([store.togglePinned("note.md"), store.setDensity("compact"), store.toggleNotebook("Work")]);
    expect(store.api.getState().preferences).toMatchObject({ pinned: ["note.md"], density: "compact", collapsedNotebooks: ["Work"], custom: { keep: true } });
    await store.move("note.md", "Work/moved.md");
    const reopened = createWorkspaceStore(record, files);
    await reopened.load();
    expect(reopened.api.getState().preferences.pinned).toEqual(["Work/moved.md"]);
    expect(reopened.api.getState().preferences.density).toBe("compact");
    expect(await files.read("note.md")).toBeUndefined();
    expect(await reopened.space.read("Work/moved.md")).toBe("words");
    await expect(reopened.togglePinned("Work/moved.md")).rejects.toThrow("read-only");
  });

  it("preserves externally changed preferences and writes a conflict copy", async () => {
    const original = JSON.stringify({ version: 1, density: "comfortable" });
    const external = JSON.stringify({ version: 1, custom: "external words" });
    const files = createMemoryFiles({ "note.md": "words", ".slate/view.json": original });
    const store = createWorkspaceStore(record, files);
    store.setOwned(true);
    await store.load();
    const read = files.read;
    let changed = false;
    files.read = async (path) => {
      const bytes = await read(path);
      if (path === ".slate/view.json" && !changed) {
        changed = true;
        await files.write(path, encodeText(external));
      }
      return bytes;
    };
    await expect(store.setDensity("compact")).rejects.toThrow("changed outside Slate");
    expect(await store.space.read(".slate/view.json")).toBe(external);
    const conflict = (await files.list(true)).find((path) => path.includes("conflicted copy"));
    expect(conflict).toBeDefined();
    expect(JSON.parse((await store.space.read(conflict!))!)).toMatchObject({ density: "compact" });
    expect(store.api.getState().preferences.density).toBe("comfortable");
    expect(await store.space.read("note.md")).toBe("words");
  });

  it("opens notes even when preferences are invalid and keeps that original configuration", async () => {
    const files = createMemoryFiles({ "note.md": "words", ".slate/view.json": "{invalid" });
    const store = createWorkspaceStore(record, files);
    store.setOwned(true);
    await store.load();
    expect(store.api.getState().notice).toContain("preferences could not be read");
    expect(store.api.getState().sheets[0]?.content).toBe("words");
    await expect(store.setDensity("compact")).rejects.toThrow();
    expect(await store.space.read(".slate/view.json")).toBe("{invalid");
    expect(await store.space.read("note.md")).toBe("words");
  });

  it("creates Today's file using the local date and reopens existing words unchanged", async () => {
    const files = createMemoryFiles();
    const store = createWorkspaceStore(record, files);
    store.setOwned(true);
    await Promise.all([store.openToday(new Date(2026, 10, 18, 0, 15)), store.openToday(new Date(2026, 10, 18, 0, 15))]);
    expect(await files.list()).toEqual(["Daily/2026-11-18.md"]);
    expect(store.api.getState().selectedPath).toBe("Daily/2026-11-18.md");
    const content = "# Today\n\nWords already here.";
    await files.write("Daily/2026-11-18.md", encodeText(content));
    await store.openToday(new Date(2026, 10, 18, 23, 15));
    expect(await files.list()).toEqual(["Daily/2026-11-18.md"]);
    expect(store.api.getState().sheets[0]?.content).toBe(content);
  });
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
    const journal = localStorage.getItem(`slate.recovery-v2.${record.id}`);
    await reader.flush();
    expect(await reader.space.read("note.md")).toBe("saved base");
    expect(localStorage.getItem(`slate.recovery-v2.${record.id}`)).toBe(journal);
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
    expect(localStorage.getItem("slate.recovery-v2.test-library")).toBeNull();
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
    expect(localStorage.getItem("slate.recovery-v2.test-library")).toContain("keep my words");
  });
});
