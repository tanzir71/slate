import { isolateHistory } from "@codemirror/commands";
import { EditorState, StateField, Transaction } from "@codemirror/state";

const isolatedInput = StateField.define<boolean>({
  create: () => false,
  update(previous, transaction) {
    const boundary = transaction.annotation(isolateHistory);
    if (boundary === "full" || boundary === "after") return true;
    if (!transaction.docChanged) return previous;
    return transaction.isUserEvent("undo") || transaction.isUserEvent("redo");
  },
});

/** A new IME update must not join an independently undoable smart edit. */
const compositionBoundary = EditorState.transactionFilter.of((transaction) => {
  if (
    !transaction.docChanged ||
    !transaction.startState.field(isolatedInput, false) ||
    transaction.annotation(Transaction.userEvent) !== "input.type.compose"
  )
    return transaction;
  // The first annotation takes precedence; retaining the original transaction
  // preserves its changes, selection, effects and other annotations.
  return [
    { annotations: Transaction.userEvent.of("input.type.compose.start") },
    transaction,
  ];
});

export const historyIsolation = [isolatedInput, compositionBoundary];
