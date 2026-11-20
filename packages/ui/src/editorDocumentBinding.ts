import { Annotation, EditorState, Prec, StateEffect, Transaction, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { editorSource, editorSourceEffects, editorSourceStateEffect, editorHistoryDelegate, type DocumentSession } from "@slate/editor";
import { shortcutOS } from "./commands";

const synchronized = Annotation.define<boolean>();

/** Each view keeps its own selection/configuration; the session owns source and history. */
export function createEditorDocumentBinding(session: DocumentSession, onError?: (error: unknown) => void) {
  const actor = {};
  let revision = session.snapshot().revision;
  function report(error: unknown) { if (onError) onError(error); else throw error; }
  const extensions: Extension[] = [
    editorHistoryDelegate.of({ replaceLast(producer, before, replacement) {
      try { return session.amendLastEdit(producer, revision, before, replacement, actor); }
      catch (error) { report(error); return false; }
    } }),
    EditorState.transactionFilter.of((transaction) => {
      if (transaction.annotation(synchronized) || !transaction.docChanged && !editorSourceEffects(transaction).length) return transaction;
      if (transaction.startState.readOnly || !session.canEdit()) return [];
      if (revision === session.snapshot().revision) return transaction;
      queueMicrotask(() => report(new Error("This pane changed. Reopen it before editing.")));
      return [];
    }),
    Prec.highest(keymap.of([{ any(view, event) {
      const mac = shortcutOS() === "mac";
      if (event.isComposing || view.compositionStarted || event.altKey || event.getModifierState("AltGraph") ||
        (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey)) return false;
      const key = event.code === "KeyZ" ? "z" : event.code === "KeyY" ? "y" : event.key.toLowerCase();
      if (key !== "z" && (key !== "y" || event.shiftKey)) return false;
      // CodeMirror first tries character shortcuts without Shift. Choose the action
      // from the event before consuming even an empty history to block native Undo.
      if (view.dom.isConnected && !view.state.readOnly) {
        if (key === "y" || event.shiftKey) session.redo(actor); else session.undo(actor);
      }
      return true;
    } }])),
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
