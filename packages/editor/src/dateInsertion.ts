import { isolateHistory } from "@codemirror/commands";
import type { EditorState, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { isIsoDate } from "@slate/core";
import {
  markdownCompletionQuery,
  type MarkdownCompletionQuery,
} from "./completionQuery.js";

export interface EditorDateRequest {
  readonly source: Text;
  readonly query: MarkdownCompletionQuery;
}

/** Opening or cancelling the picker never changes the document or its history. */
export function requestEditorDate(
  state: EditorState,
): EditorDateRequest | undefined {
  const query = markdownCompletionQuery(state);
  return query?.kind === "date" ? { source: state.doc, query } : undefined;
}

export function insertEditorDate(
  view: EditorView,
  request: EditorDateRequest,
  date: string,
): boolean {
  const current = requestEditorDate(view.state);
  if (
    !view.dom.isConnected ||
    view.compositionStarted ||
    !isIsoDate(date) ||
    !current ||
    current.source !== request.source ||
    current.query.from !== request.query.from ||
    current.query.to !== request.query.to
  )
    return false;
  view.dispatch({
    changes: { from: current.query.from, to: current.query.to, insert: date },
    selection: { anchor: current.query.from + date.length },
    annotations: isolateHistory.of("full"),
    userEvent: "input.date",
    scrollIntoView: true,
  });
  return true;
}
