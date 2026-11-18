import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import {
  countColumn,
  Prec,
  type Extension,
  type EditorState,
} from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import {
  editTableColumn,
  formatMarkdownTable,
  parseMarkdownTableLine,
  type MarkdownTable,
  type ParsedMarkdownTable,
  type TableAlignment,
} from "@slate/core";
import { tableBlurFormatting } from "./tableBlur.js";
import { markdownInputAllowed } from "./markdownInputContext.js";
import {
  editorTableAt,
  tablePoint,
  tablePosition,
  type EditorTable,
  type TablePoint,
} from "./tableStructure.js";

function editable(view: EditorView, collapsed = true) {
  const selection = view.state.selection;
  return (
    !view.state.readOnly &&
    !view.compositionStarted &&
    selection.ranges.length === 1 &&
    (!collapsed || selection.main.empty)
  );
}
function applyTable(
  view: EditorView,
  original: EditorTable,
  formatted: ParsedMarkdownTable,
  target?: TablePoint,
): boolean {
  const selection = view.state.selection.main;
  if (!target && (selection.from < original.from || selection.to > original.to))
    return false;
  const point = (position: number) =>
    original.from +
    tablePosition(
      formatted,
      tablePoint(original.parsed, position - original.from),
    );
  const next = target
    ? { anchor: original.from + tablePosition(formatted, target) }
    : { anchor: point(selection.anchor), head: point(selection.head) };
  const changed = original.parsed.source !== formatted.source;
  view.dispatch({
    ...(changed
      ? {
          changes: {
            from: original.from,
            to: original.to,
            insert: formatted.source,
          },
        }
      : {}),
    selection: next,
    ...(changed
      ? { annotations: isolateHistory.of("full"), userEvent: "input.table" }
      : {}),
    scrollIntoView: true,
  });
  return true;
}
export function editorTableColumns(state: EditorState): number {
  if (state.readOnly || state.selection.ranges.length !== 1) return 0;
  const table = editorTableAt(state, state.selection.main.head);
  return table &&
    tablePoint(table.parsed, state.selection.main.head - table.from).column <
      table.parsed.table.header.cells.length &&
    state.selection.main.from >= table.from &&
    state.selection.main.to <= table.to
    ? table.parsed.table.header.cells.length
    : 0;
}
export function formatEditorTable(view: EditorView): boolean {
  if (!editable(view, false)) return false;
  const table = editorTableAt(view.state, view.state.selection.main.head);
  const formatted = table && formatMarkdownTable(table.parsed.table);
  return !!(table && formatted && applyTable(view, table, formatted));
}
function blankRow(table: MarkdownTable, prefix = table.delimiterPrefix) {
  return { prefix, cells: table.header.cells.map(() => "") };
}
export function navigateTableCell(
  view: EditorView,
  direction: -1 | 1,
): boolean {
  if (!editable(view)) return false;
  const context = editorTableAt(view.state, view.state.selection.main.head);
  if (!context) return false;
  const point = tablePoint(
    context.parsed,
    view.state.selection.main.head - context.from,
  );
  let row = point.row,
    column = point.column + direction;
  const { rows } = context.parsed;
  if (row === 1) {
    row = direction > 0 ? 2 : 0;
    column = direction > 0 ? 0 : rows[0]!.cells.length - 1;
  } else if (column < 0) {
    row--;
    if (row === 1) row--;
    column = rows[row]?.cells.length
      ? Math.max(
          rows[row]!.cells.length,
          context.parsed.table.header.cells.length,
        ) - 1
      : 0;
  } else if (
    column >=
    Math.max(rows[row]!.cells.length, context.parsed.table.header.cells.length)
  ) {
    row++;
    if (row === 1) row++;
    column = 0;
  }
  if (row < 0) return false;
  let table = context.parsed.table;
  if (row >= rows.length)
    table = { ...table, body: [...table.body, blankRow(table)] };
  const formatted = formatMarkdownTable(table);
  return (
    !!formatted &&
    applyTable(view, context, formatted, { row, column, offset: 0 })
  );
}
function createTableFromHeader(view: EditorView): boolean {
  const state = view.state,
    position = state.selection.main.head,
    line = state.doc.lineAt(position);
  if (position !== line.to) return false;
  const tree = ensureSyntaxTree(state, state.doc.length, Infinity);
  if (!tree) return false;
  let paragraph = tree.resolveInner(position, -1);
  while (paragraph.parent && paragraph.name !== "Paragraph")
    paragraph = paragraph.parent;
  if (
    paragraph.name !== "Paragraph" ||
    paragraph.from < line.from ||
    !markdownInputAllowed(state, paragraph.from)
  )
    return false;
  const text = state.sliceDoc(paragraph.from, line.to);
  if (!text.startsWith("|") || !/\|[ \t]*$/.test(text)) return false;
  const parsed = parseMarkdownTableLine(text);
  if (!parsed || parsed.pipes.length < 2 || !parsed.cells.length) return false;
  const prefix = state.sliceDoc(line.from, paragraph.from);
  const nextPrefix = prefix.replace(/(?:[-+*]|\d{1,9}[.)])[ \t]+$/, (marker) =>
    " ".repeat(
      countColumn(prefix, state.tabSize) -
        countColumn(prefix.slice(0, -marker.length), state.tabSize),
    ),
  );
  const table: MarkdownTable = {
    header: { prefix, cells: parsed.cells.map((cell) => cell.text) },
    delimiterPrefix: nextPrefix,
    alignments: parsed.cells.map(() => "none"),
    body: [{ prefix: nextPrefix, cells: parsed.cells.map(() => "") }],
  };
  const formatted = formatMarkdownTable(table);
  if (!formatted) return false;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: formatted.source },
    selection: {
      anchor:
        line.from + tablePosition(formatted, { row: 2, column: 0, offset: 0 }),
    },
    annotations: isolateHistory.of("full"),
    userEvent: "input.table",
    scrollIntoView: true,
  });
  return true;
}
export function enterEditorTable(view: EditorView): boolean {
  if (!editable(view)) return false;
  const context = editorTableAt(view.state, view.state.selection.main.head);
  if (!context) return createTableFromHeader(view);
  const point = tablePoint(
    context.parsed,
    view.state.selection.main.head - context.from,
  );
  const table = context.parsed.table;
  const index = Math.max(0, point.row - 1);
  const body = [...table.body];
  body.splice(
    index,
    0,
    blankRow(
      table,
      context.parsed.rows[point.row]!.kind === "body"
        ? context.parsed.rows[point.row]!.prefix
        : table.delimiterPrefix,
    ),
  );
  const formatted = formatMarkdownTable({ ...table, body });
  return (
    !!formatted &&
    applyTable(view, context, formatted, {
      row: index + 2,
      column: point.column,
      offset: 0,
    })
  );
}

export function runTableCommand(view: EditorView, id: string): boolean {
  if (id === "table.format") return formatEditorTable(view);
  if (!editable(view, false) || !editorTableColumns(view.state)) return false;
  const context = editorTableAt(view.state, view.state.selection.main.head)!;
  const point = tablePoint(
    context.parsed,
    view.state.selection.main.head - context.from,
  );
  let column = point.column;
  let table: MarkdownTable | undefined;
  if (id === "table.insertBefore" || id === "table.insertAfter") {
    column += id === "table.insertAfter" ? 1 : 0;
    table = editTableColumn(context.parsed.table, {
      kind: "insert",
      index: column,
    });
  } else if (id === "table.deleteColumn") {
    table = editTableColumn(context.parsed.table, {
      kind: "delete",
      index: column,
    });
    column = Math.min(column, context.parsed.table.header.cells.length - 2);
  } else {
    const alignment = id.slice("table.align.".length);
    if (
      !id.startsWith("table.align.") ||
      !["left", "center", "right", "none"].includes(alignment)
    )
      return false;
    table = editTableColumn(context.parsed.table, {
      kind: "align",
      index: column,
      alignment: alignment as TableAlignment,
    });
  }
  const formatted = table && formatMarkdownTable(table);
  return (
    !!formatted &&
    applyTable(view, context, formatted, { ...point, column, offset: 0 })
  );
}

export function createSmartTableBindings(enabled = true): Extension {
  return enabled
    ? [
        tableBlurFormatting,
        Prec.high(
          keymap.of([
            { key: "Tab", run: (view) => navigateTableCell(view, 1) },
            { key: "Shift-Tab", run: (view) => navigateTableCell(view, -1) },
            { key: "Enter", run: enterEditorTable },
          ]),
        ),
      ]
    : [];
}
