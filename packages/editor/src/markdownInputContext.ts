import { ensureSyntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export function insideEditorFrontmatter(
  state: EditorState,
  position: number,
): boolean {
  if (!/^\uFEFF?---\s*$/.test(state.doc.line(1).text)) return false;
  const target = state.doc.lineAt(position).number;
  for (let number = 2; number <= target; number++) {
    if (/^(?:---|\.\.\.)\s*$/.test(state.doc.line(number).text))
      return number === target;
  }
  return true;
}

/** Automated Markdown input stays out of code, URLs, HTML and front matter. */
export function markdownInputAllowed(
  state: EditorState,
  position: number,
  ownWikiFrom?: number,
): boolean {
  if (insideEditorFrontmatter(state, position)) return false;
  const tree = ensureSyntaxTree(state, state.selection.main.head, 20);
  if (!tree) return false;
  for (let node = tree.resolveInner(position, 1); node; node = node.parent!) {
    if (node.name === "SlateWikiLink" && node.from === ownWikiFrom) continue;
    if (/Code|Link|URL|Autolink|HTML|Comment/.test(node.name)) return false;
  }
  return true;
}
