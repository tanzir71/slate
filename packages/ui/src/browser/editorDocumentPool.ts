import type { TextChange } from "@slate/core";
import type { DocumentSession, DocumentSessionUpdate } from "@slate/editor";
import type { WorkspaceStore } from "./workspaceStore";
import { isEditorSheetPath } from "./editorSheetPath";

type SessionFactory = (source: string, canEdit: () => boolean) => DocumentSession;

/** Space-scoped source/history, with one captured-path draft writer per file. */
export function createEditorDocumentPool(store: WorkspaceStore) {
  const entries = new Map<string, { session: DocumentSession; detach: () => void }>();
  let disposed = false;
  let connection: (() => void) | undefined;
  function sheetAt(path: string) {
    if (!isEditorSheetPath(path)) return undefined;
    const sheet = store.api.getState().sheets.find((candidate) => candidate.path === path);
    return sheet?.unsupportedEncoding ? undefined : sheet;
  }
  function synchronize() {
    for (const [path, { session }] of entries) {
      const sheet = sheetAt(path), snapshot = session.snapshot();
      if (sheet && sheet.content !== snapshot.source) session.replaceSource(sheet.content, snapshot.revision);
    }
  }
  function write(path: string, update: DocumentSessionUpdate) {
    if (update.kind === "external") return;
    const sheet = sheetAt(path);
    if (disposed || !store.api.getState().owned || sheet?.content !== update.before)
      throw new Error("These words are retained in the editor. Restore access before saving this sheet.");
    const changes: TextChange[] = [];
    update.changes.iterChanges((from, to, _nextFrom, _nextTo, insert) => { changes.push({ from, to, text: insert.toString() }); });
    const origin = update.kind === "undo" || update.kind === "redo" ? "history"
      : update.userEvent === "input.tidy" || update.userEvent?.startsWith("input.tidy.") ? "tidy" : "input";
    if (!store.editSheet(path, update.source, changes, origin)) throw new Error("This draft could not be saved. Keep its editor open to recover your words.");
  }
  return {
    get(path: string, factory: SessionFactory): DocumentSession | undefined {
      if (disposed) return undefined;
      const sheet = sheetAt(path);
      if (!sheet) return undefined;
      const existing = entries.get(path);
      if (existing) return existing.session;
      // Inject the factory from the lazy editor chunk; the shell imports no CodeMirror runtime.
      const session: DocumentSession = factory(sheet.content, (): boolean => !disposed && store.api.getState().owned && sheetAt(path)?.content === session.snapshot().source);
      const detach = session.subscribe((update) => write(path, update));
      entries.set(path, { session, detach });
      return session;
    },
    connect() {
      if (disposed) return () => undefined;
      if (connection) return connection;
      let sheets = store.api.getState().sheets;
      const stop = store.api.subscribe((state) => {
        if (sheets === state.sheets) return;
        sheets = state.sheets; synchronize();
      });
      const disconnect = () => { stop(); if (connection === disconnect) connection = undefined; };
      connection = disconnect;
      synchronize();
      return disconnect;
    },
    dispose() {
      disposed = true; connection?.();
      for (const entry of entries.values()) entry.detach();
      entries.clear();
    },
  };
}

export type EditorDocumentPool = ReturnType<typeof createEditorDocumentPool>;
