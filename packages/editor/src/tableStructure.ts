import { ensureSyntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { parseMarkdownTable, type ParsedMarkdownTable } from "@slate/core";
import { insideEditorFrontmatter } from "./markdownInputContext.js";

type MarkdownNode = NonNullable<ReturnType<typeof ensureSyntaxTree>>["topNode"];
export interface EditorTable {
  readonly from: number;
  readonly to: number;
  readonly parsed: ParsedMarkdownTable;
}
export interface TablePoint {
  readonly row: number;
  readonly column: number;
  readonly offset: number;
}
function enclosingTable(node: MarkdownNode | null): MarkdownNode | undefined {
  for (; node; node = node.parent) if (node.name === "Table") return node;
}
/** Structural commands explicitly finish parsing; ordinary input never calls this. */
export function editorTableAt(
  state: EditorState,
  position: number,
): EditorTable | undefined {
  if (insideEditorFrontmatter(state, position)) return;
  const tree = ensureSyntaxTree(state, state.doc.length, Infinity);
  if (!tree) return;
  const table =
    enclosingTable(tree.resolveInner(position, 1)) ??
    enclosingTable(tree.resolveInner(position, -1));
  if (!table) return;
  const rows: MarkdownNode[] = [];
  for (let child = table.firstChild; child; child = child.nextSibling)
    if (/^(?:TableHeader|TableDelimiter|TableRow)$/.test(child.name))
      rows.push(child);
  if (rows.length < 2) return;
  const from = state.doc.lineAt(rows[0]!.from).from;
  const to = state.doc.lineAt(rows.at(-1)!.to).to;
  const lines = rows.map((row) => {
    const line = state.doc.lineAt(row.from);
    return {
      prefix: state.sliceDoc(line.from, row.from),
      text: state.sliceDoc(row.from, line.to),
    };
  });
  const parsed = parseMarkdownTable(lines);
  // Never replace gaps or parser-excluded text with a reconstructed table.
  if (!parsed || parsed.source !== state.sliceDoc(from, to)) return;
  return { from, to, parsed };
}
export function tablePoint(
  table: ParsedMarkdownTable,
  position: number,
): TablePoint {
  let row = table.rows.findIndex((value) => position <= value.to);
  if (row < 0) row = table.rows.length - 1;
  const cells = table.rows[row]!.cells;
  let column = cells.findIndex((cell) => position <= cell.end);
  if (column < 0) column = cells.length - 1;
  const cell = cells[column]!;
  return {
    row,
    column,
    offset: Math.max(0, Math.min(position - cell.from, cell.text.length)),
  };
}
export function tablePosition(
  table: ParsedMarkdownTable,
  point: TablePoint,
): number {
  const row = table.rows[Math.min(point.row, table.rows.length - 1)]!;
  const cell = row.cells[Math.min(point.column, row.cells.length - 1)]!;
  return cell.from + Math.min(point.offset, cell.text.length);
}
