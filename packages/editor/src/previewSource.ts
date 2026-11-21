import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { editorCallout } from "./calloutPreview.js";

/** A rich preview yields to source throughout its enclosing table or callout. */
export function previewSourceRange(state: EditorState, from: number, to: number) {
  let start = from, end = to;
  for (const position of [from, to]) for (let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(position, 1); node; node = node.parent) {
    if (node.name === "Table" || node.name === "Blockquote" && editorCallout(state, node)) {
      start = Math.min(start, state.doc.lineAt(node.from).from); end = Math.max(end, node.to);
    }
  }
  return { from: start, to: end };
}
export function previewSourceActive(state: EditorState, from: number, to: number) {
  const scope = previewSourceRange(state, from, to);
  return state.selection.ranges.some(range => scope.from <= state.doc.lineAt(range.to).to && scope.to >= state.doc.lineAt(range.from).from);
}
