import { isolateHistory } from "@codemirror/commands";
import type { EditorState, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  planBuiltinBlock,
  planMarkdownBlockMove,
  scanMarkdownBlocks,
  type BlockContext,
  type BlockPlan,
  type MarkdownBlockDocument,
  type MarkdownSourceBlock,
} from "@slate/core";

const documents = new WeakMap<Text, MarkdownBlockDocument>();
function documentBlocks(source: Text): MarkdownBlockDocument {
  let document = documents.get(source);
  if (!document) {
    document = scanMarkdownBlocks(source.toString());
    documents.set(source, document);
  }
  return document;
}
export interface EditorBlockTarget {
  readonly source: Text;
  readonly document: MarkdownBlockDocument;
  readonly index: number;
  readonly block: MarkdownSourceBlock;
  readonly position: number;
}
/** Used on pointer/menu actions; ordinary editing never scans block structure. */
export function editorBlockTarget(
  state: EditorState,
  position = state.selection.main.head,
): EditorBlockTarget | undefined {
  if (state.readOnly || position < 0 || position > state.doc.length) return;
  const document = documentBlocks(state.doc);
  if (position < document.bodyFrom) return;
  const index = document.blocks.findIndex(
    (block) => position >= block.from && position <= block.to,
  );
  const block = document.blocks[index];
  if (block)
    return { source: state.doc, document, index, block, position: block.to };
  const line = state.doc.lineAt(position);
  if (line.from < document.bodyFrom || line.text.trim()) return;
  return {
    source: state.doc,
    document,
    index: -1,
    position: line.from,
    block: {
      from: line.from,
      to: line.to,
      kind: "empty",
      label: "Empty block",
    },
  };
}
export function currentEditorBlock(
  view: EditorView,
  target: EditorBlockTarget,
): boolean {
  return (
    view.dom.isConnected &&
    !view.state.readOnly &&
    !view.compositionStarted &&
    view.state.doc === target.source
  );
}
export function moveEditorBlock(
  view: EditorView,
  target: EditorBlockTarget,
  before: number,
): boolean {
  if (!currentEditorBlock(view, target) || target.index < 0) return false;
  const plan = planMarkdownBlockMove(target.document, target.index, before);
  if (!plan) return false;
  view.dispatch({
    changes: plan.changes.map(({ from, to, text }) => ({
      from,
      to,
      insert: text,
    })),
    selection: plan.selection,
    annotations: isolateHistory.of("full"),
    userEvent: "input.block.move",
    scrollIntoView: true,
  });
  return true;
}
export function insertEditorBlockAt(
  view: EditorView,
  target: EditorBlockTarget,
  id: string,
  context: Pick<BlockContext, "language" | "image" | "date" | "time"> = {},
): BlockPlan {
  if (!currentEditorBlock(view, target))
    return {
      kind: "unavailable",
      reason: "The sheet changed or is read-only. Choose the block again.",
    };
  const plan = planBuiltinBlock(id, {
    source: target.document.source,
    from: target.position,
    to: target.position,
    ...context,
    separateBlock: true,
  });
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
  return plan;
}
