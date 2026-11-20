import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseSheet } from "@slate/core";
import { createDocumentSession } from "@slate/editor";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";
import { createEditorDocumentPool } from "../src/browser/editorDocumentPool";
import { createInspectorMentionIndex } from "../src/browser/inspectorMentionIndex";
import { createInspectorLinking } from "../src/browser/inspectorLinking";

const original = "\uFEFF# Notes\r\n\r\nLaunch plan\n\n`Launch plan`\r\n", second = "# Other\n\nLAUNCH PLAN\n", targetSource = "# Launch plan\n";
const pools: ReturnType<typeof createEditorDocumentPool>[] = [];
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { for (const pool of pools.splice(0)) pool.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); });
async function setup() {
  const files = createMemoryFiles({ "a.md": original, "b.md": second, "target.md": targetSource });
  const store = createWorkspaceStore({ id: "sample", name: "Notes", tier: "library" }, files); await store.load(); await store.select("target.md");
  const pool = createEditorDocumentPool(store); pools.push(pool); pool.connect();
  const selected = parseSheet(targetSource, "target.md"), target = { id: selected.id, path: selected.path, title: selected.title, source: targetSource };
  const review = { target, sheets: store.api.getState().sheets.map(sheet => ({ ...sheet })) };
  const rows = createInspectorMentionIndex()({ id: 1, target, changed: review.sheets, removed: [] }).changed;
  return { files, store, pool, review, rows, action: createInspectorLinking(store, pool), edit: vi.spyOn(store, "editSheet") };
}

it("links real reviewed prose through each captured writer once and restores exact originals with guarded batch Undo", async () => {
  const { files, store, rows, review, action, edit } = await setup();
  expect(await action.apply(review, rows)).toBe(2); expect(edit).toHaveBeenCalledTimes(2);
  for (const row of rows) expect(await files.read(row.path)).toEqual(encodeText(row.plan.output));
  expect(await files.read("target.md")).toEqual(encodeText(targetSource)); expect(store.api.getState().selectedPath).toBe("target.md");
  expect(action.canUndo()).toBe(true); await action.undo(); expect(edit).toHaveBeenCalledTimes(4);
  expect(await files.read("a.md")).toEqual(encodeText(original)); expect(await files.read("b.md")).toEqual(encodeText(second));
  expect(action.canUndo()).toBe(false);
});

it("rereads authoritative files and refuses a stale universe without editing any reviewed file", async () => {
  const { files, rows, review, action, edit } = await setup();
  await files.write("a.md", encodeText("Newer external words"));
  await expect(action.apply(review, rows)).rejects.toThrow(/changed/);
  expect(edit).not.toHaveBeenCalled(); expect(await files.read("a.md")).toEqual(encodeText("Newer external words"));
  expect(await files.read("b.md")).toEqual(encodeText(second));
});

it("rejects changed selection and ownership, including ownership lost during asynchronous reconciliation", async () => {
  const { files, store, rows, review, action, edit } = await setup();
  await store.select("b.md"); await expect(action.apply(review, rows)).rejects.toThrow(/sheet|changed/i);
  await store.select("target.md"); store.setOwned(false); await expect(action.apply(review, rows)).rejects.toThrow(/read-only/i);
  store.setOwned(true); const list = files.list.bind(files);
  vi.spyOn(files, "list").mockImplementation(async (privateFiles) => { store.setOwned(false); return list(privateFiles); });
  await expect(action.apply(review, rows)).rejects.toThrow(/read-only/i); expect(edit).not.toHaveBeenCalled();
});

it("preserves later edits and refuses the whole batch Undo when one source/revision changed", async () => {
  const { files, store, pool, rows, review, action } = await setup(); await action.apply(review, rows);
  const session = pool.get("a.md", createDocumentSession)!, before = session.snapshot();
  expect(session.apply(before.state.update({ changes: { from: before.state.doc.length, insert: "New words" } }), before.revision)).toBe(true);
  await store.flush(); const changed = await files.read("a.md"), other = await files.read("b.md");
  expect(action.canUndo()).toBe(false); await expect(action.undo()).rejects.toThrow(/changed/);
  expect(await files.read("a.md")).toEqual(changed); expect(await files.read("b.md")).toEqual(other);
});

it("keeps conflict copies when disk changes after reconciliation and never reports a complete linking success", async () => {
  const { files, store, rows, review, action } = await setup(); let injected = false;
  const stop = store.api.subscribe(state => {
    if (!injected && state.sheets.find(sheet => sheet.path === "a.md")?.content === rows.find(row => row.path === "a.md")!.plan.output) {
      injected = true; void files.write("a.md", encodeText("External words win"));
    }
  });
  try { await expect(action.apply(review, rows)).rejects.toThrow(/changed|kept/); }
  finally { stop(); }
  expect(await files.read("a.md")).toEqual(encodeText("External words win"));
  const all = await store.space.sheets(); expect(all.some(sheet => sheet.path !== "a.md" && sheet.content === rows.find(row => row.path === "a.md")!.plan.output)).toBe(true);
  expect(action.canUndo()).toBe(false);
});
