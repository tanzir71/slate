import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { countColumn, type EditorState } from "@codemirror/state";

export type MarkdownNode = ReturnType<typeof syntaxTree>["topNode"];
const isList = (node: MarkdownNode | null) =>
  node?.name === "BulletList" || node?.name === "OrderedList";

export interface ListContext {
  list: MarkdownNode;
  siblings: MarkdownNode[];
  first: number;
  last: number;
}

function enclosingItem(node: MarkdownNode | null): MarkdownNode | undefined {
  for (; node; node = node.parent) {
    if (/^(?:FencedCode|CodeBlock|HTMLBlock)$/.test(node.name)) return;
    if (node.name === "ListItem" && isList(node.parent)) return node;
  }
}

export function listItemAt(
  state: EditorState,
  position: number,
): MarkdownNode | undefined {
  const tree = ensureSyntaxTree(state, position, 20);
  if (!tree) return;
  const direct = enclosingItem(tree.resolveInner(position, 1));
  if (direct) return direct;
  const line = state.doc.lineAt(position);
  // At the end of an item the right-biased node can be its containing list.
  if (position > line.from) {
    const previous = enclosingItem(tree.resolveInner(position, -1));
    if (previous) return previous;
  }
  const prefix = /^(?:[ \t]*>[ \t]?)*[ \t]*(?:[-+*]|\d+[.)])[ \t]*/.exec(
    line.text,
  );
  if (prefix && position <= line.from + prefix[0].length)
    return enclosingItem(tree.resolveInner(line.from + prefix[0].length, -1));
}

function itemUnder(
  item: MarkdownNode | undefined,
  list: MarkdownNode,
): MarkdownNode | undefined {
  for (let node = item; node; node = node.parent ?? undefined)
    if (
      node.name === "ListItem" &&
      node.parent?.from === list.from &&
      node.parent.name === list.name
    )
      return node;
}

export function selectedList(state: EditorState): ListContext | undefined {
  if (state.selection.ranges.length !== 1) return;
  const range = state.selection.main;
  const start = listItemAt(state, range.from);
  const end = listItemAt(
    state,
    range.to > range.from && state.doc.lineAt(range.to).from === range.to
      ? range.to - 1
      : range.to,
  );
  if (!start || !end) return;
  for (
    let item: MarkdownNode | undefined = start;
    item;
    item = enclosingItem(item.parent?.parent ?? null)
  ) {
    const list = item.parent!;
    const last = itemUnder(end, list);
    if (!last) continue;
    const siblings = list.getChildren("ListItem");
    const firstIndex = siblings.findIndex((node) => node.from === item!.from);
    const lastIndex = siblings.findIndex((node) => node.from === last.from);
    if (firstIndex >= 0 && lastIndex >= firstIndex)
      return { list, siblings, first: firstIndex, last: lastIndex };
  }
}

export function itemBounds(state: EditorState, item: MarkdownNode) {
  let end = state.doc.lineAt(Math.max(item.from, item.to - 1));
  // Loose-list separators belong to the gap, rather than the moved item.
  while (end.number > 1 && !end.text.trim())
    end = state.doc.line(end.number - 1);
  return {
    from: state.doc.lineAt(item.from).from,
    to: end.to,
  };
}

export function quoteDepth(node: MarkdownNode) {
  let depth = 0;
  for (let parent = node.parent; parent; parent = parent.parent)
    if (parent.name === "Blockquote") depth++;
  return depth;
}

export function quotePrefix(text: string, depth: number) {
  let end = 0;
  for (let level = 0; level < depth; level++) {
    const match = /^ {0,3}>[ \t]?/.exec(text.slice(end));
    if (!match) return;
    end += match[0].length;
  }
  return text.slice(0, end);
}

export function itemMarker(state: EditorState, item: MarkdownNode) {
  const mark = item.getChild("ListMark");
  if (!mark) return;
  const line = state.doc.lineAt(mark.from);
  const text = state.sliceDoc(mark.from, mark.to);
  const after = /^[ \t]*/.exec(state.sliceDoc(mark.to, line.to))![0];
  return {
    from: mark.from,
    to: mark.to,
    number: /^\d+[.)]$/.test(text) ? Number(text.slice(0, -1)) : undefined,
    column: countColumn(state.sliceDoc(line.from, mark.from), state.tabSize),
    contentColumn: countColumn(
      state.sliceDoc(line.from, mark.to) + (after || " "),
      state.tabSize,
    ),
  };
}
