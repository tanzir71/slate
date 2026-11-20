import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Transaction } from "@codemirror/state";
import { createDocumentSession, editorSourceEffect, type DocumentSession } from "@slate/editor";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";
import { createEditorDocumentPool } from "../src/browser/editorDocumentPool";

const original = "\uFEFF# Alpha\r\n\r\nWords kept.\r\n";
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
async function setup() {
  const files = createMemoryFiles({ "a.md": original, "b.md": "Beta\n" });
  const store = createWorkspaceStore({ id: "sample", name: "Notes", tier: "library" }, files); await store.load();
  const pool = createEditorDocumentPool(store), disconnect = pool.connect();
  const session = (path: string) => pool.get(path, createDocumentSession);
  return { files, store, pool, session, disconnect };
}
function append(session: DocumentSession, text: string) {
  const snapshot = session.snapshot();
  expect(session.apply(snapshot.state.update({ changes: { from: snapshot.state.doc.length, insert: text },
    annotations: Transaction.userEvent.of("input.type") }), snapshot.revision)).toBe(true);
}

it("reuses one file session and saves nonselected edits to their captured path exactly once", async () => {
  const { files, store, pool, session } = await setup();
  try {
    await store.select("b.md"); const alpha = session("a.md")!, changed = vi.spyOn(store, "editSheet");
    expect(session("a.md")).toBe(alpha); append(alpha, "From another pane");
    expect(changed).toHaveBeenCalledTimes(1); expect(changed.mock.calls[0]?.[0]).toBe("a.md");
    expect(store.api.getState().selectedPath).toBe("b.md"); await store.flush();
    expect(await files.read("a.md")).toEqual(encodeText(original + "From another pane"));
    expect(await files.read("b.md")).toEqual(encodeText("Beta\n"));
    expect(session("a.md")).toBe(alpha); expect(alpha.undo()).toBe(true); expect(changed).toHaveBeenCalledTimes(2);
    await store.flush(); expect(await files.read("a.md")).toEqual(encodeText(original));
  } finally { pool.dispose(); }
});

it("installs authoritative disk changes without echo writes or obsolete history", async () => {
  const { files, store, pool, session } = await setup();
  try {
    const alpha = session("a.md")!; append(alpha, "Saved typing"); await store.flush();
    const edit = vi.spyOn(store, "editSheet"); const external = "\uFEFF# External\r\n\r\nNewer words.\r\n";
    await files.write("a.md", encodeText(external)); await store.refresh();
    expect(alpha.snapshot().source).toBe(external); expect(alpha.undo()).toBe(false); expect(edit).not.toHaveBeenCalled();
    expect(await files.read("a.md")).toEqual(encodeText(external));
  } finally { pool.dispose(); }
});

it("keeps current drafts and original conflict bases when disk changes before autosave", async () => {
  const { files, store, pool, session } = await setup();
  try {
    const alpha = session("a.md")!; append(alpha, "My draft");
    await files.write("a.md", encodeText("External words")); await store.refresh();
    expect(alpha.snapshot().source).toBe(original + "My draft"); await store.flush();
    expect(await files.read("a.md")).toEqual(encodeText("External words"));
    const copies = (await store.space.sheets()).filter((sheet) => !["a.md", "b.md"].includes(sheet.path));
    expect(copies.map((sheet) => sheet.content)).toEqual([original + "My draft"]);
    expect(alpha.snapshot().source).toBe("External words");
  } finally { pool.dispose(); }
});

it("preserves Tidy and history origins in actual save observers", async () => {
  const { files, store, pool, session } = await setup();
  try {
    const alpha = session("a.md")!, saved = vi.fn(); store.subscribeNoteSaved(saved);
    const snapshot = alpha.snapshot(), output = original.replaceAll("\r\n", "\n");
    expect(alpha.apply(snapshot.state.update({ effects: editorSourceEffect(output), annotations: Transaction.userEvent.of("input.tidy") }), snapshot.revision)).toBe(true);
    await store.flush(); expect(saved).toHaveBeenLastCalledWith({ path: "a.md", source: output, origin: "tidy" });
    expect(alpha.undo()).toBe(true); await store.flush();
    expect(saved).toHaveBeenLastCalledWith({ path: "a.md", source: original, origin: "history" });
    expect(await files.read("a.md")).toEqual(encodeText(original));
  } finally { pool.dispose(); }
});

it("checks live ownership while retaining reader access to cached documents", async () => {
  const { files, store, pool, session } = await setup();
  try {
    const alpha = session("a.md")!, snapshot = alpha.snapshot(); store.setOwned(false);
    expect(session("a.md")).toBe(alpha); expect(alpha.canEdit()).toBe(false);
    expect(alpha.apply(snapshot.state.update({ changes: { from: 0, insert: "Not owned" } }), snapshot.revision)).toBe(false);
    expect(alpha.undo()).toBe(false); expect(await files.read("a.md")).toEqual(encodeText(original));
    store.setOwned(true); append(alpha, "Allowed"); await store.flush();
    expect(await files.read("a.md")).toEqual(encodeText(original + "Allowed"));
  } finally { pool.dispose(); }
});

it("refuses unknown, unsupported, deleted and private targets without creating sessions or files", async () => {
  const { files, store, pool, session } = await setup();
  try {
    const alpha = session("a.md")!; await files.write("bad.md", new Uint8Array([0xff]));
    await files.write(".git/words.md", encodeText("Private words")); await store.refresh();
    for (const path of ["missing.md", "bad.md", ".git/words.md", ".slate/history/a.md", "../a.md"]) expect(session(path)).toBeUndefined();
    await files.remove("a.md"); await store.refresh(); expect(session("a.md")).toBeUndefined(); expect(alpha.canEdit()).toBe(false);
    expect(alpha.apply(alpha.snapshot().state.update({ changes: { from: 0, insert: "Must not recreate" } }), alpha.snapshot().revision)).toBe(false);
    expect(await files.read("a.md")).toBeUndefined();
  } finally { pool.dispose(); }
});

it("blocks stale cached edits while disconnected, then resynchronizes without leaking old connections", async () => {
  const { files, store, pool, session, disconnect } = await setup();
  try {
    const alpha = session("a.md")!; disconnect();
    await files.write("a.md", encodeText("Fresh disk source")); await store.refresh();
    expect(alpha.canEdit()).toBe(false); expect(alpha.snapshot().source).toBe(original);
    expect(alpha.apply(alpha.snapshot().state.update({ changes: { from: 0, insert: "Old" } }), alpha.snapshot().revision)).toBe(false);
    const stop = pool.connect(); disconnect();
    expect(alpha.snapshot().source).toBe("Fresh disk source"); expect(alpha.canEdit()).toBe(true);
    await files.write("a.md", encodeText("Another disk source")); await store.refresh();
    expect(alpha.snapshot().source).toBe("Another disk source"); stop();
  } finally { pool.dispose(); }
});

it("disposes all writers and makes retained session references read-only", async () => {
  const { files, store, pool, session } = await setup(), alpha = session("a.md")!;
  pool.dispose(); pool.dispose(); expect(session("a.md")).toBeUndefined(); expect(alpha.canEdit()).toBe(false);
  expect(alpha.apply(alpha.snapshot().state.update({ changes: { from: 0, insert: "Disposed" } }), alpha.snapshot().revision)).toBe(false);
  await store.flush(); expect(await files.read("a.md")).toEqual(encodeText(original));
});

it("journals real source changes under the file identity and recovers them before autosave", async () => {
  const record = { id: "pooled-recovery", name: "Notes", tier: "library" } as const;
  const files = createMemoryFiles({ "a.md": "# Alpha\n\nWords kept.\n", "b.md": "Beta\n" });
  const store = createWorkspaceStore(record, files); store.setOwned(true); await store.load();
  const pool = createEditorDocumentPool(store); pool.connect();
  try {
    await store.select("b.md"); const alpha = pool.get("a.md", createDocumentSession)!;
    const edit = vi.spyOn(store, "editSheet"), length = alpha.snapshot().state.doc.length;
    append(alpha, "First"); append(alpha, " second");
    expect(edit.mock.calls[0]?.[2]).toEqual([{ from: length, to: length, text: "First" }]);
    expect(edit.mock.calls[1]?.[2]).toEqual([{ from: length + 5, to: length + 5, text: " second" }]);
    expect(await files.read("a.md")).toEqual(encodeText("# Alpha\n\nWords kept.\n"));
    const reopened = createWorkspaceStore(record, files); reopened.setOwned(true); await reopened.load();
    expect(reopened.api.getState().sheets.find((sheet) => sheet.path === "a.md")?.content).toBe(alpha.snapshot().source);
    await reopened.flush(); expect(await files.read("a.md")).toEqual(encodeText("# Alpha\n\nWords kept.\nFirst second"));
    expect(await files.read("b.md")).toEqual(encodeText("Beta\n"));
  } finally { pool.dispose(); }
});
