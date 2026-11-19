import { isolateHistory } from "@codemirror/commands";
import type { EditorSelection, EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  planCustomBlock,
  type BlockPlan,
  type MarkdownFragment,
} from "@slate/core";
import { editorBlockQuery } from "./blockInsertion.js";
import type { EditorBlockTarget } from "./editorBlocks.js";

export interface EditorCustomBlockRequest {
  readonly source: Text;
  readonly selection: EditorSelection;
  readonly from: number;
  readonly to: number;
}

/** Capture a slash or gutter insertion before asynchronous file access. */
export function requestEditorCustomBlock(
  state: EditorState,
  target?: EditorBlockTarget,
): EditorCustomBlockRequest | undefined {
  if (
    state.readOnly ||
    !state.facet(EditorView.editable) ||
    state.selection.ranges.length !== 1
  )
    return;
  let from: number, to: number;
  if (target) {
    if (
      target.source !== state.doc ||
      !Number.isSafeInteger(target.position) ||
      target.position < target.document.bodyFrom ||
      target.position > state.doc.length
    )
      return;
    from = to = target.position;
  } else {
    const query = editorBlockQuery(state);
    if (!query) return;
    from = query.from;
    to = query.to;
  }
  return { source: state.doc, selection: state.selection, from, to };
}

/** Apply an explicit fragment choice only while its editor snapshot remains current. */
export function insertEditorCustomBlock(
  view: EditorView,
  request: EditorCustomBlockRequest,
  block: MarkdownFragment,
): BlockPlan {
  const { state } = view;
  if (
    !view.dom.isConnected ||
    state.readOnly ||
    !state.facet(EditorView.editable) ||
    view.compositionStarted ||
    state.doc !== request.source ||
    !state.selection.eq(request.selection)
  )
    return {
      kind: "unavailable",
      reason: "The sheet changed or is read-only. Choose the block again.",
    };
  const plan = planCustomBlock(block, {
    source: state.doc.toString(),
    from: request.from,
    to: request.to,
  });
  view.dispatch({
    changes: plan.changes.map(({ from, to, text }) => ({
      from,
      to,
      insert: text,
    })),
    selection: plan.selection,
    annotations: isolateHistory.of("full"),
    userEvent: "input.block",
    scrollIntoView: true,
  });
  view.focus();
  return plan;
}
