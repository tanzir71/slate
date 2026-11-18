import { formatMarkdownTable } from "./markdownTable.js";

export type DelimitedSeparator = "," | "\t";

/** RFC-style quoted fields also handle Excel's quoted tab-separated clipboard data. */
export function parseDelimitedText(
  source: string,
  separator: DelimitedSeparator,
): readonly (readonly string[])[] | undefined {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "";
  let quoted = false,
    closed = false,
    start = true,
    ended = false;
  function finishField() {
    row.push(field);
    field = "";
    closed = false;
    start = true;
  }
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    ended = false;
    if (quoted) {
      if (character !== '"') field += character;
      else if (source[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (character === separator) {
      finishField();
    } else if (character === "\r" || character === "\n") {
      finishField();
      rows.push(row);
      row = [];
      if (character === "\r" && source[index + 1] === "\n") index++;
      ended = true;
    } else if (character === '"' && start && !closed) {
      quoted = true;
      start = false;
    } else {
      if (closed || character === '"') return;
      field += character;
      start = false;
    }
  }
  if (quoted) return;
  if (!ended) {
    finishField();
    rows.push(row);
  }
  return rows;
}

function literalLine(line: string): string {
  const leading = /^ */.exec(line)![0].length;
  const rest = line.slice(leading);
  const trailing = / *$/.exec(rest)![0].length;
  // ASCII punctuation is backslash-escapable in CommonMark. Generated entities
  // come afterwards, preserving field whitespace and literal entity-looking data.
  const content = rest
    .slice(0, rest.length - trailing)
    .replace(/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/g, "\\$&")
    .replace(/\t/g, "&#9;");
  return "&#32;".repeat(leading) + content + "&#32;".repeat(trailing);
}
function literalCell(value: string): string {
  return value
    .split(/\r\n|\r|\n/)
    .map(literalLine)
    .join("<br>");
}
function inferredRows(source: string) {
  for (const separator of ["\t", ","] as const) {
    const rows = parseDelimitedText(source, separator);
    const count = rows?.[0]?.length ?? 0;
    if (
      rows &&
      count > 1 &&
      (separator === "\t" || rows.length > 1) &&
      rows.every((row) => row.length > 1)
    )
      return rows;
  }
}

/** Inference needs delimited records; declared formats also accept one-cell rows. */
export function clipboardTable(
  source: string,
  separator?: DelimitedSeparator,
): string | undefined {
  if (!source || source.includes("\u0000")) return;
  const rows = separator
    ? parseDelimitedText(source, separator)
    : inferredRows(source);
  if (!rows?.length) return;
  const count = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const normalized = rows.map((row) => ({
    prefix: "",
    cells: Array.from({ length: count }, (_unused, column) =>
      literalCell(row[column] ?? ""),
    ),
  }));
  return formatMarkdownTable({
    header: normalized[0]!,
    delimiterPrefix: "",
    alignments: Array.from({ length: count }, () => "none"),
    body: normalized.slice(1),
  })?.source;
}
