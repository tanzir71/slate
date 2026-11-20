import { Annotation, EditorState, Prec, StateEffect, Transaction, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { editorSource, editorSourceEffects, editorSourceStateEffect, type DocumentSession } from "@slate/editor";

const synchronized = Annotation.define<boolean>();

/** Each view keeps its own selection/configuration; the session owns source and history. */
export function createEditorDocumentBinding(session: DocumentSession, onError?: (error: unknown) => void) {
  const actor = {};
  let revision = session.snapshot().revision;
  function report(error: unknown) { if (onError) onError(error); else throw error; }
  const extensions: Extension[] = [
    EditorState.transactionFilter.of((transaction) => {
      if (transaction.annotation(synchronized) || !transaction.docChanged && !editorSourceEffects(transaction).length) return transaction;
      if (transaction.startState.readOnly || !session.canEdit()) return [];
      if (revision === session.snapshot().revision) return transaction;
      queueMicrotask(() => report(new Error("This pane changed. Reopen it before editing.")));
      return [];
    }),
    Prec.highest(keymap.of([
      { key: "Mod-z", run(view) { if (view.dom.isConnected && !view.state.readOnly) session.undo(actor); return true; } },
      { key: "Mod-Shift-z", run(view) { if (view.dom.isConnected && !view.state.readOnly) session.redo(actor); return true; } },
      { key: "Mod-y", run(view) { if (view.dom.isConnected && !view.state.readOnly) session.redo(actor); return true; } },
    ])),
    EditorView.updateListener.of((update) => {
      for (const transaction of update.transactions) {
        if (transaction.annotation(synchronized) || !transaction.docChanged && !editorSourceEffects(transaction).length) continue;
        try {
          if (!session.apply(transaction, revision, actor) && editorSource(transaction.state) !== session.snapshot().source)
            throw new Error("This edit could not be applied. Keep this pane open to recover its words.");
        } catch (error) { report(error); }
      }
    }),
  ];
  return {
    state(configuration: readonly Extension[], selection: { anchor: number }) {
      const snapshot = session.snapshot(); revision = snapshot.revision;
      // Fresh view callbacks replace the canonical configuration; exact source fields survive.
      return snapshot.state.update({ effects: [StateEffect.reconfigure.of([...configuration, ...extensions]), editorSourceStateEffect(snapshot.state)], selection }).state;
    },
    connect(view: EditorView) {
      return session.subscribe((update) => {
        if (update.kind === "edit" && update.actor === actor) { revision = update.revision; return; }
        view.dispatch({ changes: update.changes, effects: update.effects, ...(update.actor === actor ? { selection: update.selection } : {}), filter: false,
          annotations: [synchronized.of(true), Transaction.remote.of(true), Transaction.addToHistory.of(false)] });
        revision = update.revision;
      });
    },
  };
}
