import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
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

/** Read only the caret's line unless it contains an eligible slash query. */
export function editorBlockQuery(state: EditorState): BlockQuery | undefined {
  const selection = state.selection.main;
  if (state.readOnly || !selection.empty) return;
  const line = state.doc.lineAt(selection.head);
  const match = /(?:^|\s)\/([^\n/]{0,64})$/.exec(
    line.text.slice(0, selection.head - line.from),
  );
  if (!match) return;
  const from = selection.head - match[1]!.length - 1;
  if (insideFrontmatter(state, from)) return;
  const tree = ensureSyntaxTree(state, selection.head, 20);
  if (!tree) return;
  for (let node = tree.resolveInner(from, 1); node;) {
    if (/Code|Link|URL|Autolink|HTML/.test(node.name)) return;
    if (!node.parent) break;
    node = node.parent;
  }
  return { from, to: selection.head, query: match[1]! };
}

function insideFrontmatter(state: EditorState, position: number) {
  if (!/^\uFEFF?---\s*$/.test(state.doc.line(1).text)) return false;
  const target = state.doc.lineAt(position).number;
  for (let number = 2; number <= target; number++) {
    if (/^(?:---|\.\.\.)\s*$/.test(state.doc.line(number).text))
      return number === target;
  }
  return true;
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
