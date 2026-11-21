import { countColumn, type EditorState, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { BlockWrapper, Decoration, ViewPlugin, WidgetType, type EditorView } from "@codemirror/view";
import { parseMarkdownTable, parseMarkdownTableLine, type TableAlignment } from "@slate/core";
import { insideEditorFrontmatter } from "./markdownInputContext.js";

type MarkdownNode = ReturnType<typeof syntaxTree>["topNode"];
export interface PreviewTable {
  readonly from: number;
  readonly to: number;
  readonly headerLine: number;
  readonly columns: number;
  readonly alignments: readonly TableAlignment[];
  readonly prefix: string;
  readonly headerOnly: boolean;
}

/** Read the two header lines of an already parsed table, not its body. */
export function previewTable(state: EditorState, node: MarkdownNode): PreviewTable | undefined {
  if (insideEditorFrontmatter(state, node.from)) return;
  const header = node.getChild("TableHeader"), delimiter = node.getChild("TableDelimiter");
  if (!header || !delimiter) return;
  const lines = [header, delimiter].map(row => {
    const line = state.doc.lineAt(row.from);
    return { prefix: state.sliceDoc(line.from, row.from), text: state.sliceDoc(row.from, line.to) };
  });
  const parsed = parseMarkdownTable(lines);
  if (!parsed) return;
  const line = state.doc.lineAt(header.from);
  return { from: line.from, to: node.to, headerLine: line.number,
    columns: parsed.table.header.cells.length, alignments: parsed.table.alignments,
    prefix: lines[0]!.prefix, headerOnly: node.lastChild?.name === "TableDelimiter" };
}

export function previewTableWrappers(state: EditorState, table: PreviewTable, calloutDepth: number): Range<BlockWrapper>[] {
  const quoteDepth = Math.max(0, (table.prefix.match(/>/g)?.length ?? 0) - calloutDepth);
  const remainder = table.prefix.replace(/>[\t ]?/g, "");
  const indent = quoteDepth * 16 + countColumn(remainder, state.tabSize) * 8;
  const marker = /(?:^|\s)([-+*]|\d{1,9}[.)])[\t ]+$/.exec(remainder)?.[1];
  const wrappers = [BlockWrapper.create({ tagName: "div", rank: 0, attributes: {
    class: `cm-slate-table-grid cm-slate-table-cols-${table.columns}`, role: "table", tabindex: "0", "aria-label": "Markdown table",
    "aria-description": "Use arrow keys to scroll. Press Enter to edit the table.",
    "aria-colcount": String(table.columns),
    "aria-rowcount": String(state.doc.lineAt(table.to).number - table.headerLine),
  } }).range(table.from, table.to)];
  if (indent) wrappers.push(BlockWrapper.create({ tagName: "div", rank: 1, attributes: {
    class: `cm-slate-table-container${quoteDepth ? " cm-slate-table-quoted" : ""}`,
    style: `padding-inline-start:${indent}px;--slate-table-list-offset:${quoteDepth * 16}px;--slate-table-quote-shadows:${Array.from({ length: Math.max(0, quoteDepth - 1) }, (_, index) => `${(index + 1) * 16}px 0 0 var(--border-strong)`).join(",") || "none"}`,
    ...(marker ? { "data-list-marker": /^\d/.test(marker) ? marker : "•" } : {}),
  } }).range(table.from, table.to));
  return wrappers;
}

function tableKey(event: KeyboardEvent, view: EditorView) {
  const grid = event.target;
  if (!(grid instanceof HTMLElement) || !grid.classList.contains("cm-slate-table-grid") || event.ctrlKey || event.metaKey || event.altKey) return;
  const horizontal = event.key === "ArrowLeft" ? -40 : event.key === "ArrowRight" ? 40 : 0;
  const vertical = event.key === "ArrowUp" ? -40 : event.key === "ArrowDown" ? 40
    : event.key === "PageUp" ? -view.scrollDOM.clientHeight : event.key === "PageDown" ? view.scrollDOM.clientHeight : 0;
  if (horizontal) grid.scrollLeft += horizontal;
  else if (vertical) view.scrollDOM.scrollTop += vertical;
  else if (event.key === "Home" || event.key === "End") grid.scrollLeft = event.key === "Home" ? 0 : grid.scrollWidth;
  else if (event.key === "Enter") {
    view.dispatch({ selection: { anchor: view.posAtDOM(grid, 0) }, scrollIntoView: true });
    view.focus();
  } else if (event.key === "Escape") view.focus();
  else if (event.key === "Tab") { event.stopPropagation(); return; }
  else if (event.key.length !== 1 && event.key !== "Backspace" && event.key !== "Delete") return;
  event.preventDefault();
  event.stopPropagation();
}

/** Keep focused scroll-region keys out of the editable document's keymap. */
export const tablePreviewKeyboard = ViewPlugin.define(view => {
  const keydown = (event: KeyboardEvent) => tableKey(event, view);
  view.dom.addEventListener("keydown", keydown, true);
  return { destroy() { view.dom.removeEventListener("keydown", keydown, true); } };
});

function cellClass(column: number, table: PreviewTable) {
  return `cm-slate-table-cell cm-slate-table-column-${column} cm-slate-table-align-${table.alignments[column] ?? "none"}${column === table.columns - 1 ? " cm-slate-table-cell-last" : ""}`;
}
class EmptyTableCell extends WidgetType {
  constructor(private className: string, private header: boolean, private column: number) { super(); }
  eq(other: EmptyTableCell) { return this.className === other.className && this.header === other.header && this.column === other.column; }
  toDOM() {
    const cell = document.createElement("span");
    cell.className = this.className;
    cell.setAttribute("role", this.header ? "columnheader" : "cell");
    cell.setAttribute("aria-colindex", String(this.column + 1));
    cell.setAttribute("aria-label", "Empty cell");
    return cell;
  }
  ignoreEvent() { return false; }
}

/** Cell marks retain the editor's native text, source positions and inline links. */
export function previewTableRow(state: EditorState, row: MarkdownNode, table: PreviewTable): Range<Decoration>[] {
  const line = state.doc.lineAt(row.from);
  if (row.name === "TableDelimiter") return [Decoration.line({ class: "cm-slate-table-delimiter", attributes: { "aria-hidden": "true", role: "presentation" } }).range(line.from)];
  const parsed = parseMarkdownTableLine(state.sliceDoc(row.from, line.to));
  if (!parsed) return [];
  const header = row.name === "TableHeader", last = row.to === table.to || header && table.headerOnly;
  const result = [Decoration.line({ class: `cm-slate-table-row${header ? " cm-slate-table-header" : ""}${last ? " cm-slate-table-row-last" : ""}`,
    attributes: { role: "row", "aria-rowindex": String(header ? 1 : line.number - table.headerLine), style: `min-inline-size:${table.columns === 3 ? 678 : table.columns * 120}px` },
  }).range(line.from)];
  const hide = (from: number, to: number) => { if (from < to) result.push(Decoration.replace({}).range(from, to)); };
  let position = line.from;
  for (let column = 0; column < table.columns; column++) {
    const cell = parsed.cells[column], className = cellClass(column, table);
    if (!cell) {
      const point = row.from + (parsed.cells.at(-1)?.end ?? 0);
      result.push(Decoration.widget({ widget: new EmptyTableCell(className, header, column), side: 1 }).range(point));
      continue;
    }
    const start = row.from + cell.start, end = row.from + cell.end;
    hide(position, start);
    if (!cell.text) {
      const widget = new EmptyTableCell(className, header, column);
      result.push(start === end ? Decoration.widget({ widget, side: 1 }).range(start) : Decoration.replace({ widget }).range(start, end));
    }
    else {
      // Include a replacement that occupies the entire unpadded cell.
      result.push(Decoration.mark({ class: className, inclusive: true, attributes: { role: header ? "columnheader" : "cell", "aria-colindex": String(column + 1) } }).range(start, end));
      hide(start, row.from + cell.from); hide(row.from + cell.to, end);
    }
    position = end;
  }
  hide(position, line.to);
  return result;
}
