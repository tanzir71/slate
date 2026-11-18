export type TableAlignment = "none" | "left" | "right" | "center";

export interface MarkdownTableLine {
  readonly prefix: string;
  readonly text: string;
}
export interface TableCellRange {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly from: number;
  readonly to: number;
}
export interface ParsedTableLine {
  readonly cells: readonly TableCellRange[];
  readonly pipes: readonly number[];
}
export interface MarkdownTableRow {
  readonly prefix: string;
  readonly cells: readonly string[];
}
export interface MarkdownTable {
  readonly header: MarkdownTableRow;
  readonly delimiterPrefix: string;
  readonly alignments: readonly TableAlignment[];
  readonly body: readonly MarkdownTableRow[];
}
export type TableColumnEdit =
  | { readonly kind: "insert"; readonly index: number }
  | { readonly kind: "delete"; readonly index: number }
  | {
      readonly kind: "align";
      readonly index: number;
      readonly alignment: TableAlignment;
    };
export interface ParsedTableRow {
  readonly kind: "header" | "delimiter" | "body";
  readonly from: number;
  readonly to: number;
  readonly prefix: string;
  readonly cells: readonly TableCellRange[];
}
export interface ParsedMarkdownTable {
  readonly source: string;
  readonly table: MarkdownTable;
  readonly rows: readonly ParsedTableRow[];
}

export function editTableColumn(
  table: MarkdownTable,
  edit: TableColumnEdit,
): MarkdownTable | undefined {
  const count = table.header.cells.length;
  const limit = edit.kind === "insert" ? count : count - 1;
  if (
    !count ||
    table.alignments.length !== count ||
    !Number.isInteger(edit.index) ||
    edit.index < 0 ||
    edit.index > limit ||
    (edit.kind === "delete" && count === 1)
  )
    return;
  if (edit.kind === "align")
    return {
      ...table,
      alignments: table.alignments.map((value, index) =>
        index === edit.index ? edit.alignment : value,
      ),
    };
  const alignments = [...table.alignments];
  if (edit.kind === "insert") alignments.splice(edit.index, 0, "none");
  else alignments.splice(edit.index, 1);
  function row(source: MarkdownTableRow): MarkdownTableRow {
    const cells = Array.from(
      { length: Math.max(count, source.cells.length) },
      (_unused, index) => source.cells[index] ?? "",
    );
    if (edit.kind === "insert") cells.splice(edit.index, 0, "");
    else cells.splice(edit.index, 1);
    return { prefix: source.prefix, cells };
  }
  return {
    ...table,
    header: row(table.header),
    body: table.body.map(row),
    alignments,
  };
}

const multiline = /[\r\n]/;
const blank = /^[ \t]*$/;

function cellRange(text: string, start: number, end: number): TableCellRange {
  const value = text.slice(start, end);
  const leading = /^[ \t]*/.exec(value)![0].length;
  if (leading === value.length) {
    const point = start + Math.min(1, leading);
    return { text: "", start, end, from: point, to: point };
  }
  const trailing = /[ \t]*$/.exec(value)![0].length;
  const from = start + leading;
  const to = start + Math.max(leading, value.length - trailing);
  return { text: text.slice(from, to), start, end, from, to };
}

/** GFM pipes are structural even inside code spans unless backslash-escaped. */
export function parseMarkdownTableLine(
  text: string,
): ParsedTableLine | undefined {
  if (multiline.test(text)) return;
  const pipes: number[] = [];
  let backslashes = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "\\") {
      backslashes++;
      continue;
    }
    if (character === "|" && backslashes % 2 === 0) pipes.push(index);
    backslashes = 0;
  }
  const cells: TableCellRange[] = [];
  let start = 0;
  for (const pipe of pipes) {
    cells.push(cellRange(text, start, pipe));
    start = pipe + 1;
  }
  cells.push(cellRange(text, start, text.length));
  if (pipes.length && blank.test(text.slice(0, pipes[0]))) cells.shift();
  if (
    pipes.length &&
    cells.length > 1 &&
    blank.test(text.slice(pipes.at(-1)! + 1))
  )
    cells.pop();
  return { cells, pipes };
}

function alignment(text: string): TableAlignment {
  return text.startsWith(":")
    ? text.endsWith(":")
      ? "center"
      : "left"
    : text.endsWith(":")
      ? "right"
      : "none";
}

/** Container prefixes come from the Markdown parser, so list/quote syntax stays intact. */
export function parseMarkdownTable(
  lines: readonly MarkdownTableLine[],
): ParsedMarkdownTable | undefined {
  if (lines.length < 2 || lines.some((line) => multiline.test(line.prefix)))
    return;
  const parsed = lines.map((line) => parseMarkdownTableLine(line.text));
  if (parsed.some((line) => !line)) return;
  const header = parsed[0]!;
  const delimiter = parsed[1]!;
  if (
    !header.pipes.length ||
    !header.cells.length ||
    header.cells.length !== delimiter.cells.length ||
    !delimiter.cells.every((cell) => /^:?-+:?$/.test(cell.text))
  )
    return;
  if (lines.slice(2).some((line) => blank.test(line.text))) return;
  let offset = 0;
  const rows = lines.map((line, index): ParsedTableRow => {
    const from = offset;
    const to = from + line.prefix.length + line.text.length;
    offset = to + 1;
    const base = from + line.prefix.length;
    return {
      kind: index === 0 ? "header" : index === 1 ? "delimiter" : "body",
      from,
      to,
      prefix: line.prefix,
      cells: parsed[index]!.cells.map((cell) => ({
        ...cell,
        start: cell.start + base,
        end: cell.end + base,
        from: cell.from + base,
        to: cell.to + base,
      })),
    };
  });
  const row = (index: number): MarkdownTableRow => ({
    prefix: lines[index]!.prefix,
    cells: parsed[index]!.cells.map((cell) => cell.text),
  });
  return {
    source: lines.map((line) => line.prefix + line.text).join("\n"),
    rows,
    table: {
      header: row(0),
      delimiterPrefix: lines[1]!.prefix,
      alignments: delimiter.cells.map((cell) => alignment(cell.text)),
      body: lines.slice(2).map((_line, index) => row(index + 2)),
    },
  };
}

function colonCount(value: TableAlignment): number {
  return value === "center" ? 2 : value === "none" ? 0 : 1;
}
function delimiterCell(value: TableAlignment, width: number): string {
  const dashes = "-".repeat(width - colonCount(value));
  return (
    (value === "left" || value === "center" ? ":" : "") +
    dashes +
    (value === "right" || value === "center" ? ":" : "")
  );
}

/** Canonical padding never truncates cells that GFM would omit from rendered output. */
export function formatMarkdownTable(
  table: MarkdownTable,
): ParsedMarkdownTable | undefined {
  const count = table.header.cells.length;
  const allRows = [table.header, ...table.body];
  if (
    !count ||
    table.alignments.length !== count ||
    multiline.test(table.delimiterPrefix) ||
    allRows.some(
      (row) =>
        multiline.test(row.prefix) ||
        row.cells.some(
          (cell) =>
            multiline.test(cell) ||
            parseMarkdownTableLine(cell)!.pipes.length > 0,
        ),
    )
  )
    return;
  const widths = table.alignments.map((value) => 3 + colonCount(value));
  for (const row of allRows)
    for (let index = 0; index < row.cells.length; index++)
      widths[index] = Math.max(widths[index] ?? 3, row.cells[index]!.length);
  function line(row: MarkdownTableRow, minimum: number): MarkdownTableLine {
    const cells = Array.from(
      { length: Math.max(minimum, row.cells.length) },
      (_unused, index) => (row.cells[index] ?? "").padEnd(widths[index]!),
    );
    return { prefix: row.prefix, text: `| ${cells.join(" | ")} |` };
  }
  const delimiter = table.alignments.map((value, index) =>
    delimiterCell(value, widths[index]!),
  );
  return parseMarkdownTable([
    line(table.header, count),
    { prefix: table.delimiterPrefix, text: `| ${delimiter.join(" | ")} |` },
    ...table.body.map((row) => line(row, count)),
  ]);
}
