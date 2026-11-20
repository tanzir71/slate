import { history, isolateHistory, redo, undo } from "@codemirror/commands";
import { EditorState, Transaction, type Annotation, type AnnotationType, type ChangeSet, type EditorSelection, type StateCommand, type StateEffect } from "@codemirror/state";
import { historyIsolation } from "./historyIsolation.js";
import { editorSource, editorSourceEffect, editorSourceEffects, tidyEditorHistory } from "./tidy.js";

export interface DocumentSessionSnapshot {
  readonly state: EditorState;
  readonly source: string;
  readonly revision: number;
}
export interface DocumentSessionUpdate {
  readonly kind: "edit" | "undo" | "redo" | "external";
  readonly userEvent: string | undefined;
  readonly actor: object | undefined;
  readonly changes: ChangeSet;
  readonly effects: readonly StateEffect<unknown>[];
  readonly selection: EditorSelection;
  readonly source: string;
  readonly before: string;
  readonly revision: number;
}
export interface DocumentSession {
  snapshot(): DocumentSessionSnapshot;
  canEdit(): boolean;
  subscribe(listener: (update: DocumentSessionUpdate) => void): () => void;
  /** A rejected proposal stays with its caller for explicit reconciliation or recovery. */
  apply(transaction: Transaction, revision: number, actor?: object): boolean;
  undo(actor?: object): boolean;
  redo(actor?: object): boolean;
  /** Guard captured requests with a revision; new disk/batch source resets obsolete Undo. */
  replaceSource(source: string, revision?: number): boolean;
}
function stateFor(source: string, selection?: EditorSelection) {
  return EditorState.create({ doc: source.replace(/\r\n?/g, "\n"), ...(selection ? { selection } : {}),
    extensions: [history(), historyIsolation, tidyEditorHistory(source)] });
}
function historyAnnotations(transaction: Transaction): Annotation<unknown>[] {
  const values: Annotation<unknown>[] = [];
  function keep<T>(type: AnnotationType<T>) {
    const value = transaction.annotation(type);
    if (value !== undefined) values.push(type.of(value));
  }
  keep(Transaction.time); keep(Transaction.userEvent); keep(Transaction.addToHistory); keep(Transaction.remote); keep(isolateHistory);
  return values;
}
function documentChange(previous: string, next: string) {
  let from = 0, to = previous.length, end = next.length;
  while (from < to && from < end && previous[from] === next[from]) from++;
  while (to > from && end > from && previous[to - 1] === next[end - 1]) { to--; end--; }
  return { from, to, insert: next.slice(from, end) };
}

/** One retained history per open file, independent of mounted editor views. */
export function createDocumentSession(source: string, canEdit: () => boolean = () => true): DocumentSession {
  let current: DocumentSessionSnapshot = Object.freeze({ state: stateFor(source), source, revision: 0 });
  const listeners = new Set<(update: DocumentSessionUpdate) => void>();
  let notifying = false;
  function assertIdle() {
    if (notifying) throw new Error("Finish the current document update before editing again.");
  }
  function publish(state: EditorState, transaction: Transaction, source: string, actor: object | undefined, kind: DocumentSessionUpdate["kind"]) {
    const before = current.source;
    current = Object.freeze({ state, source, revision: current.revision + 1 });
    const update: DocumentSessionUpdate = Object.freeze({ kind, userEvent: transaction.annotation(Transaction.userEvent), actor, changes: transaction.changes, effects: editorSourceEffects(transaction),
      selection: state.selection, source, before, revision: current.revision });
    const errors: unknown[] = [];
    notifying = true;
    try { for (const listener of [...listeners]) { try { listener(update); } catch (error) { errors.push(error); } } }
    finally { notifying = false; }
    if (errors.length) throw new AggregateError(errors, "The document was kept, but an editor view could not update.");
  }
  function travel(command: StateCommand, actor: object | undefined, kind: "undo" | "redo") {
    if (!canEdit()) return false;
    assertIdle();
    return command({ state: current.state, dispatch(transaction) {
      publish(transaction.state, transaction, editorSource(transaction.state), actor, kind);
    } });
  }
  return {
    snapshot: () => current,
    canEdit,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    apply(transaction, revision, actor) {
      if (!canEdit() || transaction.startState.readOnly || revision !== current.revision || !transaction.startState.doc.eq(current.state.doc) || editorSource(transaction.startState) !== current.source) return false;
      const source = editorSource(transaction.state);
      if (source === current.source) return false;
      assertIdle();
      const time = transaction.annotation(Transaction.time);
      const aligned = current.state.selection.eq(transaction.startState.selection) ? current.state : current.state.update({ selection: transaction.startState.selection,
        annotations: [Transaction.addToHistory.of(false), ...(time === undefined ? [] : [Transaction.time.of(time)])] }).state;
      const next = aligned.update({ changes: transaction.changes, selection: transaction.state.selection,
        effects: editorSourceEffects(transaction), annotations: historyAnnotations(transaction) });
      publish(next.state, next, source, actor, "edit");
      return true;
    },
    undo: (actor) => travel(undo, actor, "undo"),
    redo: (actor) => travel(redo, actor, "redo"),
    replaceSource(source, revision) {
      if (revision !== undefined && revision !== current.revision) return false;
      if (source === current.source) return false;
      assertIdle();
      const next = current.state.update({ changes: documentChange(current.state.doc.toString(), source.replace(/\r\n?/g, "\n")),
        effects: editorSourceEffect(source), annotations: Transaction.addToHistory.of(false) });
      // A new disk/batch source is authoritative; old Undo cannot erase those words.
      publish(stateFor(source, next.state.selection), next, source, undefined, "external");
      return true;
    },
  };
}
