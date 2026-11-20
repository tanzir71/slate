import { history, isolateHistory, redo, undo } from "@codemirror/commands";
import { EditorState, Transaction, type Annotation, type AnnotationType, type ChangeSet, type EditorSelection, type StateCommand, type StateEffect, type Text } from "@codemirror/state";
import { historyIsolation } from "./historyIsolation.js";
import { editorSource, editorSourceEffect, editorSourceEffects, editorSourceStateEffect, tidyEditorHistory } from "./tidy.js";
import type { EditorHistoryReplacement } from "./documentHistory.js";

export interface DocumentSessionSnapshot {
  readonly state: EditorState;
  readonly source: string;
  readonly revision: number;
}
export interface DocumentSessionUpdate {
  readonly kind: "edit" | "amend" | "undo" | "redo" | "external";
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
  /** Replace only the guarded last action; publish its net source change once. */
  amendLastEdit(producer: EditorState, revision: number, before: Text, replacement: EditorHistoryReplacement, actor?: object): boolean;
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
  function accepts(producer: EditorState, revision: number) {
    return canEdit() && !producer.readOnly && revision === current.revision && producer.doc.eq(current.state.doc) && editorSource(producer) === current.source;
  }
  return {
    snapshot: () => current,
    canEdit,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    apply(transaction, revision, actor) {
      if (!accepts(transaction.startState, revision)) return false;
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
    amendLastEdit(producer, revision, before, replacement, actor) {
      if (!accepts(producer, revision)) return false;
      assertIdle();
      let restored: Transaction | undefined;
      undo({ state: current.state, dispatch(transaction) { restored = transaction; } });
      if (!restored || !restored.state.doc.eq(before)) return false;
      const chosen = restored.state.update({ changes: replacement.changes, selection: replacement.selection,
        userEvent: replacement.userEvent, annotations: isolateHistory.of("full") });
      const source = editorSource(chosen.state);
      if (source === current.source) return false;
      // The authority installs the rewritten history, while views/writers receive
      // only the net change from the currently visible source to the final source.
      const net = current.state.update({ changes: restored.changes.compose(chosen.changes), selection: chosen.state.selection,
        effects: editorSourceStateEffect(chosen.state), userEvent: replacement.userEvent });
      publish(chosen.state, net, source, actor, "amend");
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
