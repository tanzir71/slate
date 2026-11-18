import type TurndownService from "turndown";
import { formatMarkdownTable, type TableAlignment } from "@slate/core";

function escapePipes(text: string): string {
  let escaped = "",
    backslashes = 0;
  for (const character of text) {
    if (character === "|" && backslashes % 2 === 0) escaped += "\\";
    escaped += character;
    backslashes = character === "\\" ? backslashes + 1 : 0;
  }
  return escaped;
}
export function htmlTableMarkdown(
  table: HTMLTableElement,
  service: TurndownService,
): string {
  const rows = Array.from(table.rows);
  const grid: string[][] = [],
    alignments: TableAlignment[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const line = (grid[rowIndex] ??= []);
    let column = 0;
    for (const cell of Array.from(row.cells)) {
      while (line[column] !== undefined) column++;
      const content = escapePipes(
        service
          .turndown(cell)
          .replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "")
          .replace(/\r\n?|\n/g, "<br>"),
      );
      const alignment =
        cell.style.textAlign || cell.getAttribute("align") || "none";
      const align: TableAlignment =
        alignment === "left" || alignment === "center" || alignment === "right"
          ? alignment
          : "none";
      const rowEnd = Math.min(
        rows.length,
        cell.rowSpan === 0 ? rows.length : rowIndex + cell.rowSpan,
      );
      for (let down = rowIndex; down < rowEnd; down++) {
        const target = (grid[down] ??= []);
        for (let across = column; across < column + cell.colSpan; across++)
          target[across] =
            down === rowIndex && across === column ? content : "";
      }
      for (let across = column; across < column + cell.colSpan; across++)
        if (!alignments[across] || (rowIndex === 0 && align !== "none"))
          alignments[across] = align;
      column += cell.colSpan;
    }
  }
  const columns = grid.reduce(
    (maximum, row) => Math.max(maximum, row.length),
    0,
  );
  const formatted = grid.map((row) => ({
    prefix: "",
    cells: Array.from(
      { length: columns },
      (_unused, column) => row[column] ?? "",
    ),
  }));
  const markdown = columns
    ? (formatMarkdownTable({
        header: formatted[0]!,
        delimiterPrefix: "",
        alignments: Array.from(
          { length: columns },
          (_unused, column) => alignments[column] ?? "none",
        ),
        body: formatted.slice(1),
      })?.source ?? "")
    : "";
  const caption = table.caption ? service.turndown(table.caption) : "";
  return [caption, markdown].filter(Boolean).join("\n\n");
}
