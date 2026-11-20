import { applyDocumentSourceChanges, createDocumentSession, type DocumentSession } from "@slate/editor";
import type { WorkspaceStore } from "./workspaceStore";
import type { EditorDocumentPool } from "./editorDocumentPool";
import type { MentionRead, MentionRow } from "./inspectorMentionProtocol";

interface LinkedFile { session: DocumentSession; before: string; after: string; revision: number }
const changedMessage = "The sheets changed. Wait for their current mentions, then link again.";

/** A Space's canonical sessions persist changes; this controller retains guarded batch Undo. */
export function createInspectorLinking(store: WorkspaceStore, pool: EditorDocumentPool) {
  const history: LinkedFile[][] = [];
  let busy = false;
  function writable() { if (!store.api.getState().owned) throw Error("This Space is read-only. Choose Use here to edit."); }
  function selected(review: MentionRead) {
    writable(); if (!review.target || store.api.getState().selectedPath !== review.target.path) throw Error(changedMessage);
  }
  function current(file: LinkedFile) {
    const snapshot = file.session.snapshot(); return file.session.canEdit() && snapshot.source === file.after && snapshot.revision === file.revision;
  }
  async function exclusive<T>(work: () => Promise<T>) {
    if (busy) throw Error("Finish the current linking operation first.");
    busy = true; try { return await work(); } finally { busy = false; }
  }
  return {
    canUndo: () => !busy && !!history.at(-1)?.length && history.at(-1)!.every(current),
    apply(review: MentionRead, rows: readonly MentionRow[]) {
      return exclusive(async () => {
        selected(review); await store.flush(); await store.refresh(); selected(review);
        const sheets = store.api.getState().sheets, reviewed = new Map(review.sheets.map(sheet => [sheet.path, sheet]));
        if (sheets.length !== reviewed.size || sheets.some(sheet => reviewed.get(sheet.path)?.content !== sheet.content ||
          !!reviewed.get(sheet.path)?.unsupportedEncoding !== !!sheet.unsupportedEncoding) ||
          reviewed.get(review.target!.path)?.content !== review.target!.source) throw Error(changedMessage);
        const seen = new Set<string>();
        const prepared = rows.map(row => {
          const target = row.plan.target, expected = review.target!;
          if (seen.has(row.path) || row.path === expected.path || reviewed.get(row.path)?.content !== row.plan.source ||
            target.id !== expected.id || target.path !== expected.path || target.title !== expected.title) throw Error(changedMessage);
          seen.add(row.path);
          const session = pool.get(row.path, createDocumentSession), snapshot = session?.snapshot();
          if (!session?.canEdit() || snapshot?.source !== row.plan.source) throw Error(changedMessage);
          return { row, session, snapshot };
        });
        if (!prepared.length) return 0;
        const group: LinkedFile[] = []; let count = 0;
        for (const { row, session, snapshot } of prepared) {
          try {
            if (!applyDocumentSourceChanges(session, snapshot, row.plan, "input.link.mentions")) throw Error(changedMessage);
            count += row.plan.changes.length;
          } finally {
            const after = session.snapshot();
            if (after.revision === snapshot.revision + 1 && after.source === row.plan.output) {
              if (!group.length) history.push(group);
              group.push({ session, before: snapshot.source, after: after.source, revision: after.revision });
            }
          }
        }
        await store.flush();
        if (!group.every(current)) throw Error("Some files changed while saving. Newer words were kept; review the Space notice before linking again.");
        return count;
      });
    },
    undo() {
      return exclusive(async () => {
        writable(); await store.flush(); await store.refresh(); writable();
        const group = history.at(-1);
        if (!group?.length || !group.every(current)) throw Error("Some linked sheets changed. Undo their newer edits before undoing linking.");
        const restored = [...group].reverse();
        for (const file of restored) {
          if (!current(file) || !file.session.undo()) throw Error("A linked sheet changed. Your newer words were kept.");
          group.splice(group.indexOf(file), 1);
        }
        history.pop(); await store.flush();
        if (restored.some(file => file.session.snapshot().source !== file.before))
          throw Error("Some files changed while undoing. Newer words and recovery copies were kept; review the Space notice.");
      });
    },
  };
}

const controllers = new WeakMap<EditorDocumentPool, ReturnType<typeof createInspectorLinking>>();
/** Keep Undo available after closing the Inspector or navigating to another sheet. */
export function inspectorLinking(store: WorkspaceStore, pool: EditorDocumentPool) {
  let controller = controllers.get(pool);
  if (!controller) { controller = createInspectorLinking(store, pool); controllers.set(pool, controller); }
  return controller;
}
