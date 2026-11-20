import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDocumentSession } from "@slate/editor";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";
import { createEditorDocumentPool } from "../src/browser/editorDocumentPool";
import { createWorkspaceEditorLayout } from "../src/browser/workspaceEditorLayout";

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
async function setup() {
  const files = createMemoryFiles({ "a.md": "Alpha", "b.md": "Beta", "c.md": "Gamma" });
  const store = createWorkspaceStore({ id: "sample", name: "Notes", tier: "library" }, files); await store.load();
  const layout = createWorkspaceEditorLayout(store), disconnect = layout.connect(); return { files, store, layout, disconnect };
}
it("tracks real selected files as ordered, unique tabs", async () => {
  const { store, layout } = await setup(); expect(layout.getSnapshot()).toEqual({ tabs: ["a.md"], primary: "a.md", secondary: undefined, active: "primary" });
  await store.select("b.md"); await store.select("a.md"); await store.select("b.md");
  expect(layout.getSnapshot()).toEqual({ tabs: ["a.md", "b.md"], primary: "b.md", secondary: undefined, active: "primary" });
});
it("splits the current file, routes new opens to the focused pane, and projects focus synchronously", async () => {
  const { store, layout } = await setup(); expect(layout.split()).toBe(true);
  expect(layout.getSnapshot()).toMatchObject({ primary: "a.md", secondary: "a.md", active: "secondary" });
  expect(layout.open("b.md")).toBe(true); expect(layout.getSnapshot()).toMatchObject({ primary: "a.md", secondary: "b.md" });
  expect(layout.focus("primary")).toBe(true); expect(store.api.getState().selectedPath).toBe("a.md");
  await store.select("c.md"); expect(layout.getSnapshot()).toMatchObject({ primary: "c.md", secondary: "b.md", active: "primary" });
});
it("collapses to the focused file while retaining other tabs and unsaved words", async () => {
  const { files, store, layout } = await setup(); layout.split(); layout.open("b.md"); store.edit("Beta draft");
  expect(layout.collapse()).toBe(true); expect(layout.getSnapshot()).toEqual({ tabs: ["a.md", "b.md"], primary: "b.md", secondary: undefined, active: "primary" });
  expect(store.api.getState().selectedPath).toBe("b.md"); await store.flush(); expect(await files.read("b.md")).toEqual(encodeText("Beta draft"));
});
it("closes inactive tabs without moving focus, and replaces a closed visible file in both panes", async () => {
  const { store, layout } = await setup(); layout.open("b.md"); layout.open("c.md");
  expect(layout.close("a.md")).toBe(true); expect(store.api.getState().selectedPath).toBe("c.md");
  layout.split(); expect(layout.close("c.md")).toBe(true);
  expect(layout.getSnapshot()).toEqual({ tabs: ["b.md"], primary: "b.md", secondary: "b.md", active: "secondary" });
  expect(store.api.getState().selectedPath).toBe("b.md"); expect(layout.close("unknown.md")).toBe(false);
});
it("closes the final tab without deleting notes or discarding the retained file history", async () => {
  const { files, store, layout } = await setup(); const pool = createEditorDocumentPool(store); pool.connect();
  try {
    const session = pool.get("a.md", createDocumentSession)!; session.apply(session.snapshot().state.update({ changes: { from: 5, insert: " draft" } }), 0);
    layout.split(); layout.close("a.md"); await store.refresh();
    expect(layout.getSnapshot()).toEqual({ tabs: [], primary: "", secondary: undefined, active: "primary" });
    expect(store.api.getState().selectedPath).toBe(""); expect(pool.get("a.md", createDocumentSession)).toBe(session);
    layout.open("a.md"); expect(session.undo()).toBe(true); await store.flush();
    expect(await files.read("a.md")).toEqual(encodeText("Alpha"));
  } finally { pool.dispose(); }
});
it("prunes deleted files and follows a conflict-copy selection without targeting the external original", async () => {
  const { files, store, layout } = await setup(); layout.open("b.md"); store.edit("My Beta");
  await files.write("b.md", encodeText("External Beta")); await store.flush();
  const copy = store.api.getState().selectedPath; expect(copy).not.toBe("b.md");
  expect(layout.getSnapshot().primary).toBe(copy); expect(layout.getSnapshot().tabs).toContain(copy);
  await files.remove("a.md"); await store.refresh(); expect(layout.getSnapshot().tabs).not.toContain("a.md");
  expect(await files.read("b.md")).toEqual(encodeText("External Beta")); expect(await files.read(copy)).toEqual(encodeText("My Beta"));
});
it("keeps snapshot identity and listeners quiet for source-only edits", async () => {
  const { store, layout } = await setup(), changed = vi.fn(), snapshot = layout.getSnapshot(); layout.subscribe(changed);
  store.edit("Typed words"); expect(layout.getSnapshot()).toBe(snapshot); expect(changed).not.toHaveBeenCalled();
});
it("refuses missing targets and absent secondary panes, including after disposal", async () => {
  const { store, layout } = await setup(), snapshot = layout.getSnapshot();
  expect(layout.open("missing.md")).toBe(false); expect(layout.focus("secondary")).toBe(false); expect(layout.collapse()).toBe(false);
  expect(layout.getSnapshot()).toBe(snapshot); layout.dispose();
  expect(layout.split()).toBe(false); expect(layout.open("b.md")).toBe(false); expect(layout.close("a.md")).toBe(false);
  await store.select("b.md"); expect(layout.getSnapshot()).toBe(snapshot);
});

it("refuses private metadata paths even when an adapter's file cache contains them", async () => {
  const { files, store, layout } = await setup();
  await files.write(".git/private.md", encodeText("Private words")); await store.refresh(); const before = layout.getSnapshot();
  expect(layout.open(".git/private.md")).toBe(false); expect(layout.getSnapshot()).toBe(before);
  expect(store.api.getState().selectedPath).toBe("a.md"); expect(await files.read(".git/private.md")).toEqual(encodeText("Private words"));
});
it("reconnects current selections without allowing an old disconnect to stop the new subscription", async () => {
  const { store, layout, disconnect } = await setup(); disconnect(); await store.select("b.md");
  expect(layout.getSnapshot().primary).toBe("a.md"); const stop = layout.connect(); disconnect(); await store.select("c.md");
  expect(layout.getSnapshot().primary).toBe("c.md"); expect(layout.getSnapshot().tabs).toEqual(["a.md", "b.md", "c.md"]); stop();
});

it("invalidates a pending open when focus moves to another pane showing the same file", async () => {
  const { files, store, layout } = await setup(); layout.split(); const read = files.read;
  let release!: () => void, entered!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; }), started = new Promise<void>((resolve) => { entered = resolve; });
  vi.spyOn(files, "read").mockImplementation(async (path) => { if (path === "b.md") { entered(); await pending; } return read(path); });
  const opening = store.openSheet("b.md"); await started; layout.focus("primary"); release();
  await expect(opening).rejects.toThrow(/changed/); expect(store.api.getState().selectedPath).toBe("a.md");
  expect(layout.getSnapshot()).toMatchObject({ primary: "a.md", secondary: "a.md", active: "primary" });
});
