import { isolateHistory } from "@codemirror/commands";
import type { Transaction } from "@codemirror/state";
import { applyTextChanges, type TextChange } from "@slate/core";
import type { DocumentSession, DocumentSessionSnapshot } from "./documentSession.js";
import { editorSourceEffect } from "./tidy.js";

const normalize = (source: string) => source.replace(/\r\n?/g, "\n");
function sourceOffsets(source: string) {
  const ends = [...source.matchAll(/\r\n/g)].map(match => match.index + 2);
  return (position: number) => {
    let low = 0, high = ends.length;
    while (low < high) { const middle = (low + high) >>> 1; if (ends[middle]! <= position) low = middle + 1; else high = middle; }
    return position - low;
  };
}
/** Explicit reviewed source action; retained sessions own history and their captured file writer. */
export function applyDocumentSourceChanges(session: DocumentSession, expected: Pick<DocumentSessionSnapshot, "source" | "revision">,
  plan: { readonly source: string; readonly output: string; readonly changes: readonly TextChange[] }, userEvent: string): boolean {
  const current = session.snapshot();
  if (!session.canEdit() || current.revision !== expected.revision || current.source !== expected.source || current.source !== plan.source ||
    !plan.changes.length || plan.output === plan.source) return false;
  const offset = sourceOffsets(plan.source);
  let transaction: Transaction;
  try {
    if (applyTextChanges(plan.source, plan.changes) !== plan.output) return false;
    const changes = plan.changes.map(({ from, to, text }) => ({ from: offset(from), to: offset(to), insert: normalize(text) }));
    if (current.state.changes(changes).apply(current.state.doc).toString() !== normalize(plan.output)) return false;
    transaction = current.state.update({ changes, effects: editorSourceEffect(plan.output), annotations: isolateHistory.of("full"), userEvent });
  } catch { return false; }
  // Operational failures must reach the caller, including a published action
  // whose listener failed; its source and history remain retained in the session.
  return session.apply(transaction, expected.revision);
}
