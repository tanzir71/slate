import { isolateHistory } from "@codemirror/commands";
import {
  EditorSelection,
  type EditorState,
  type SelectionRange,
  type Text,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { contextualPaste } from "./pasteMarkdown.js";

export interface PasteRequest {
  readonly source: Text;
  readonly selection: EditorSelection;
}
export function requestPaste(state: EditorState): PasteRequest {
  return { source: state.doc, selection: state.selection };
}
export function currentPaste(view: EditorView, request: PasteRequest): boolean {
  return (
    view.dom.isConnected &&
    !view.state.readOnly &&
    !view.compositionStarted &&
    view.state.doc === request.source &&
    view.state.selection.eq(request.selection)
  );
}
export function insertPaste(
  view: EditorView,
  request: PasteRequest,
  value: string | ((range: SelectionRange) => string),
  block = false,
): boolean {
  if (!currentPaste(view, request)) return false;
  const changes = view.state.changeByRange((range) => {
    const raw = typeof value === "string" ? value : value(range);
    const plan = block
      ? contextualPaste(view.state, range, raw)
      : { insert: raw, cursor: raw.length };
    return {
      changes: { from: range.from, to: range.to, insert: plan.insert },
      range: EditorSelection.cursor(range.from + plan.cursor),
    };
  });
  view.dispatch({
    ...changes,
    annotations: isolateHistory.of("full"),
    userEvent: "input.paste",
    scrollIntoView: true,
  });
  return true;
}
