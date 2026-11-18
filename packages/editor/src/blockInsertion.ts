import { isolateHistory } from "@codemirror/commands";
import { markdownInputAllowed } from "./markdownInputContext.js";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  planBuiltinBlock,
  type BlockContext,
  type BlockPlan,
} from "@slate/core";

export interface BlockQuery {
  from: number;
  to: number;
  query: string;
}

/** Bound lookback before inspecting syntax, including on a 50k-word paragraph. */
export function editorBlockQuery(state: EditorState): BlockQuery | undefined {
  const selection = state.selection.main;
  if (state.readOnly || !selection.empty) return;
  const start = Math.max(0, selection.head - 67);
  const match = /(?:^|\s)\/([^\n/]{0,64})$/.exec(
    state.sliceDoc(start, selection.head),
  );
  if (!match) return;
  const from = selection.head - match[1]!.length - 1;
  // The lookback's start is not necessarily the start of a Markdown line.
  if (from > 0 && !/\s/.test(state.sliceDoc(from - 1, from))) return;
  if (!markdownInputAllowed(state, from)) return;
  return { from, to: selection.head, query: match[1]! };
}

/** Keep the resource picker outside the editor and reject stale async results. */
export function insertEditorBlock(
  view: EditorView,
  id: string,
  context: Omit<BlockContext, "source">,
  expectedSource = view.state.doc.toString(),
): BlockPlan {
  if (view.state.readOnly)
    return { kind: "unavailable", reason: "This sheet is read-only." };
  if (view.state.doc.toString() !== expectedSource)
    return {
      kind: "unavailable",
      reason: "The sheet changed while choosing this block. Try again.",
    };
  const plan = planBuiltinBlock(id, { ...context, source: expectedSource });
  if (plan.kind !== "insert") return plan;
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
