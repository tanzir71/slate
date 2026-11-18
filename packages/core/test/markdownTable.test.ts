import { expect, it } from "vitest";
import {
  parseMarkdownTableLine,
  parseMarkdownTable,
  formatMarkdownTable,
  editTableColumn,
  type MarkdownTableLine,
} from "../src/markdownTable";

const lines = (source: string): MarkdownTableLine[] =>
  source.split("\n").map((text) => ({ prefix: "", text }));

it.each([0, 1, 2])(
  "inserts column %d and retains ragged rows and extra data",
  (index) => {
    const parsed = parseMarkdownTable(lines("|A|B|\n|-|-|\n|x|\n|u|v|keep|"))!;
    const before = JSON.stringify(parsed.table);
    const edited = editTableColumn(parsed.table, { kind: "insert", index })!;
    const expected = ["A", "B"];
    expected.splice(index, 0, "");
    expect(edited.header.cells).toEqual(expected);
    expect(edited.alignments).toHaveLength(3);
    expect(edited.body[0]?.cells).toHaveLength(3);
    expect(edited.body[1]?.cells.at(-1)).toBe("keep");
    expect(formatMarkdownTable(edited)?.source).toContain("keep");
    expect(JSON.stringify(parsed.table)).toBe(before);
  },
);

it.each([0, 1])(
  "deletes only requested column %d and retains excess cells",
  (index) => {
    const table = parseMarkdownTable(
      lines("|A|B|\n|-|-|\n|x|\n|u|v|keep|"),
    )!.table;
    const edited = editTableColumn(table, { kind: "delete", index })!;
    expect(edited.header.cells).toEqual(index === 0 ? ["B"] : ["A"]);
    expect(edited.body[0]?.cells).toEqual(index === 0 ? [""] : ["x"]);
    expect(edited.body[1]?.cells).toEqual(
      index === 0 ? ["v", "keep"] : ["u", "keep"],
    );
    expect(table.header.cells).toEqual(["A", "B"]);
  },
);

it("changes only the requested column's alignment", () => {
  const table = parseMarkdownTable(lines("|A|B|\n|-|-|\n|x|y|"))!.table;
  const edited = editTableColumn(table, {
    kind: "align",
    index: 1,
    alignment: "center",
  })!;
  expect(edited.alignments).toEqual(["none", "center"]);
  expect(edited.header).toEqual(table.header);
  expect(edited.body).toEqual(table.body);
  expect(formatMarkdownTable(edited)?.source).toContain("| --- | :---: |");
  expect(table.alignments).toEqual(["none", "none"]);
});

it.each([-1, 0.5, NaN, Infinity, 3])(
  "refuses invalid column index %s without changing the model",
  (index) => {
    const table = parseMarkdownTable(lines("|A|B|\n|-|-|"))!.table;
    for (const operation of [
      { kind: "insert", index },
      { kind: "delete", index },
      { kind: "align", index, alignment: "left" },
    ] as const)
      expect(editTableColumn(table, operation)).toBeUndefined();
    expect(table.header.cells).toEqual(["A", "B"]);
  },
);

it("refuses deleting the last column and edits outside existing column bounds", () => {
  const table = parseMarkdownTable(lines("|A|\n|-|"))!.table;
  expect(editTableColumn(table, { kind: "delete", index: 0 })).toBeUndefined();
  expect(editTableColumn(table, { kind: "delete", index: 1 })).toBeUndefined();
  expect(
    editTableColumn(table, { kind: "align", index: 1, alignment: "right" }),
  ).toBeUndefined();
  expect(
    editTableColumn({ ...table, alignments: [] }, { kind: "insert", index: 0 }),
  ).toBeUndefined();
});

it.each([
  ["| a | b |", ["a", "b"]],
  ["a|b", ["a", "b"]],
  ["| a", ["a"]],
  ["a |", ["a"]],
  ["||", [""]],
  ["|", [""]],
  ["| a ||", ["a", ""]],
  ["| a\\|b | c |", ["a\\|b", "c"]],
  ["| a\\\\| b |", ["a\\\\", "b"]],
  ["| `a|b` | c |", ["`a", "b`", "c"]],
  ["| \u00a0keep\u00a0 | ", ["\u00a0keep\u00a0"]],
  ["text without pipes", ["text without pipes"]],
] as const)(
  "reads cell source without interpreting or losing it: %s",
  (source, expected) => {
    expect(
      parseMarkdownTableLine(source)?.cells.map((cell) => cell.text),
    ).toEqual(expected);
  },
);

it("reports exact UTF-16 cell positions, including empty cells and ASCII padding", () => {
  const source = "| বাংলা |  | 👩‍💻 |";
  const parsed = parseMarkdownTableLine(source)!;
  for (const cell of parsed.cells) {
    expect(source.slice(cell.from, cell.to)).toBe(cell.text);
    expect(cell.from).toBeGreaterThanOrEqual(cell.start);
    expect(cell.to).toBeLessThanOrEqual(cell.end);
  }
  expect(parsed.cells.map((cell) => cell.text)).toEqual(["বাংলা", "", "👩‍💻"]);
});

it.each(["a\nb", "a\rb"])("rejects multiline cell rows: %j", (source) => {
  expect(parseMarkdownTableLine(source)).toBeUndefined();
});

it("accepts GFM one-hyphen delimiters and normalizes all alignment forms", () => {
  const parsed = parseMarkdownTable(lines("| a | b | c | d |\n|-|:-|-:|:-:|"))!;
  expect(parsed.table.alignments).toEqual(["none", "left", "right", "center"]);
  const formatted = formatMarkdownTable(parsed.table)!;
  expect(formatted.source).toBe(
    "| a   | b    | c    | d     |\n| --- | :--- | ---: | :---: |",
  );
});

it("aligns a table idempotently without mutating its model", () => {
  const parsed = parseMarkdownTable(lines("|a|longer|\n|-|-|\n|item|x|"))!;
  Object.freeze(parsed.table.header.cells);
  Object.freeze(parsed.table.header);
  Object.freeze(parsed.table.body[0]!.cells);
  Object.freeze(parsed.table.body[0]);
  Object.freeze(parsed.table.body);
  Object.freeze(parsed.table);
  const before = JSON.stringify(parsed.table);
  const formatted = formatMarkdownTable(parsed.table)!;
  expect(formatted.source).toBe(
    "| a    | longer |\n| ---- | ------ |\n| item | x      |",
  );
  expect(formatMarkdownTable(formatted.table)?.source).toBe(formatted.source);
  expect(JSON.stringify(parsed.table)).toBe(before);
});

it("retains excess body cells and pads missing cells without changing the header count", () => {
  const table = parseMarkdownTable(
    lines("|a|b|\n|-|-|\n|x|\n|x|y|keep this|"),
  )!;
  const formatted = formatMarkdownTable(table.table)!;
  expect(formatted.table.header.cells).toEqual(["a", "b"]);
  expect(formatted.table.body.map((row) => row.cells)).toEqual([
    ["x", ""],
    ["x", "y", "keep this"],
  ]);
  expect(formatted.source).toContain("| x   | y   | keep this |");
});

it("places an empty-cell caret after its opening space rather than against the closing pipe", () => {
  const table = parseMarkdownTable(lines("|a|b|\n|-|-|\n||"))!;
  const formatted = formatMarkdownTable(table.table)!;
  const row = formatted.rows[2]!;
  expect(row.cells.map((cell) => cell.from - row.from)).toEqual([2, 8]);
  expect(row.cells.every((cell) => cell.from === cell.to)).toBe(true);
});

it("retains a GFM body row without pipes and fills its missing cells", () => {
  const table = parseMarkdownTable(lines("a | b\n- | -\nwords"))!;
  expect(formatMarkdownTable(table.table)?.table.body[0]?.cells).toEqual([
    "words",
    "",
  ]);
});

it("preserves container prefixes and source positions across differently indented rows", () => {
  const input = [
    { prefix: "> - ", text: "| a | b |" },
    { prefix: ">   ", text: "|-|-|" },
    { prefix: ">   ", text: "|বাংলা|x|" },
  ];
  const parsed = parseMarkdownTable(input)!;
  const formatted = formatMarkdownTable(parsed.table)!;
  expect(formatted.source.split("\n").map((row) => row.slice(0, 4))).toEqual([
    "> - ",
    ">   ",
    ">   ",
  ]);
  for (const row of formatted.rows)
    for (const cell of row.cells)
      expect(formatted.source.slice(cell.from, cell.to)).toBe(cell.text);
  expect(formatted.table.body[0]?.cells).toEqual(["বাংলা", "x"]);
});

it("keeps escaped pipes, inline code, nonbreaking spaces and Unicode intact", () => {
  const source = "|café|👩‍💻|\n|---|---|\n|`a\\|b`|\u00a0keep\u00a0|";
  const parsed = parseMarkdownTable(lines(source))!;
  const formatted = formatMarkdownTable(parsed.table)!;
  expect(formatted.table.header.cells).toEqual(["café", "👩‍💻"]);
  expect(formatted.table.body[0]?.cells).toEqual([
    "`a\\|b`",
    "\u00a0keep\u00a0",
  ]);
  expect(formatMarkdownTable(formatted.table)?.source).toBe(formatted.source);
});

it.each([
  "|a|b|",
  "title\n---",
  "|a|b|\n|---|",
  "|a|\n|not a delimiter|",
  "|a|\n|---|\n\n|b|",
])(
  "rejects incomplete or mismatched tables without discarding source: %j",
  (source) => {
    expect(parseMarkdownTable(lines(source))).toBeUndefined();
  },
);

it("refuses multiline prefixes or invalid model shapes instead of dropping data", () => {
  expect(
    parseMarkdownTable([
      { prefix: "\n", text: "| a |" },
      { prefix: "", text: "|---|" },
    ]),
  ).toBeUndefined();
  const table = parseMarkdownTable(lines("|a|\n|---|"))!.table;
  expect(
    formatMarkdownTable({ ...table, header: { prefix: "", cells: [] } }),
  ).toBeUndefined();
  expect(formatMarkdownTable({ ...table, alignments: [] })).toBeUndefined();
  expect(
    formatMarkdownTable({
      ...table,
      body: [{ prefix: "", cells: ["keep\nall"] }],
    }),
  ).toBeUndefined();
});

it("refuses an unescaped pipe in a model cell instead of silently splitting its data", () => {
  const table = parseMarkdownTable(lines("|a|\n|---|"))!.table;
  expect(
    formatMarkdownTable({
      ...table,
      body: [{ prefix: "", cells: ["keep|together"] }],
    }),
  ).toBeUndefined();
  expect(
    formatMarkdownTable({
      ...table,
      body: [{ prefix: "", cells: ["keep\\|together"] }],
    })?.table.body[0]?.cells,
  ).toEqual(["keep\\|together"]);
});
