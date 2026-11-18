import { expect, it } from "vitest";
import { parseMarkdownPreview, type MarkdownPreviewNode } from "../src/blocks";
import { parseMarkdownTable } from "../src/markdownTable";
import { parseDelimitedText, clipboardTable } from "../src/clipboardText";

it.each([
  ["", [[""]]],
  ["a,b", [["a", "b"]]],
  [
    "a,b\nc,d",
    [
      ["a", "b"],
      ["c", "d"],
    ],
  ],
  [
    "a,b\r\nc,d\r\n",
    [
      ["a", "b"],
      ["c", "d"],
    ],
  ],
  [
    "a,b\rc,d",
    [
      ["a", "b"],
      ["c", "d"],
    ],
  ],
  ["a,b,", [["a", "b", ""]]],
  [
    ",\n,",
    [
      ["", ""],
      ["", ""],
    ],
  ],
  ["a,b\n\n", [["a", "b"], [""]]],
  ['"a,b","c""d"', [["a,b", 'c"d']]],
  ['"a\r\nb",c', [["a\r\nb", "c"]]],
  ['"a\nb",c', [["a\nb", "c"]]],
  ['"", "', undefined],
  [" a , b ", [[" a ", " b "]]],
  ["Café,বাংলা 📝", [["Café", "বাংলা 📝"]]],
  ["\uFEFFa,b", [["\uFEFFa", "b"]]],
  [
    "a,b\nc,d,e",
    [
      ["a", "b"],
      ["c", "d", "e"],
    ],
  ],
] as const)(
  "parses quoted CSV without discarding field characters: %j",
  (source, rows) => {
    expect(parseDelimitedText(source, ",")).toEqual(rows);
  },
);
it.each(['"unfinished', 'a"b,c', '"a"x,b', '"a" ,b', '"a""'])(
  "refuses malformed quotes instead of guessing: %j",
  (source) => {
    expect(parseDelimitedText(source, ",")).toBeUndefined();
    expect(clipboardTable(source, ",")).toBeUndefined();
  },
);
it("parses quoted spreadsheet tabs and embedded tabs", () => {
  expect(
    parseDelimitedText('Name\tValue\n"a\tb"\t"He said ""yes"""', "\t"),
  ).toEqual([
    ["Name", "Value"],
    ["a\tb", 'He said "yes"'],
  ]);
});
it.each(["a,b\nc,d", "a,b\r\nc,d\r\n", "a\tb\nc\td", '"a"\t"b"\n"c"\t"d"'])(
  "detects a rectangular clipboard table: %j",
  (source) => {
    expect(clipboardTable(source)).toBe(
      "| a   | b   |\n| --- | --- |\n| c   | d   |",
    );
  },
);
it("accepts an unambiguous single spreadsheet row but keeps a comma sentence literal", () => {
  expect(clipboardTable("a\tb")).toBe("| a   | b   |\n| --- | --- |");
  expect(clipboardTable("Hello, friend")).toBeUndefined();
  expect(clipboardTable("Hello, friend", ",")).toBe(
    "| Hello | &#32;friend |\n| ----- | ----------- |",
  );
});
it.each([
  "words",
  "words\nmore words",
  "a,b\nc",
  "a\tb\nc",
  'a,b\nc,"unfinished',
  "a,b\nc,\u0000",
])("leaves ambiguous or unrepresentable plain data untouched: %j", (source) => {
  expect(clipboardTable(source)).toBeUndefined();
});
it("preserves every ragged field when the clipboard declares CSV explicitly", () => {
  const markdown = clipboardTable("Name\nAlpha,extra,last\nBeta,other", ",")!;
  expect(cells(markdown)).toEqual([
    ["Name", "", ""],
    ["Alpha", "extra", "last"],
    ["Beta", "other", ""],
  ]);
});
function text(node: MarkdownPreviewNode): string {
  if (node.type === "html" && node.value === "<br>") return "\n";
  return node.value ?? (node.children ?? []).map(text).join("");
}
function cells(markdown: string): string[][] {
  const table = parseMarkdownPreview(markdown).children?.find(
    (node) => node.type === "table",
  );
  expect(table).toBeDefined();
  return table!.children!.map((row) => row.children!.map(text));
}
it("serializes literal cells without interpreting Markdown, HTML or entities", () => {
  const rows = [
    ["Name", "Data"],
    ["**bold**", "[label](https://example.test)"],
    ["`x|y`", "<script>alert(1)</script>"],
    ["&copy;", "#tag ==mark== $money$"],
    ["\\path", "Café বাংলা 📝"],
    [" leading ", "\tinside\ttab\t"],
    ["\u00a0value\u00a0", "   "],
    ["line\nbreak", "paragraph\n\nbreak"],
  ];
  const csv = rows
    .map((row) =>
      row.map((value) => '"' + value.replaceAll('"', '""') + '"').join(","),
    )
    .join("\r\n");
  const markdown = clipboardTable(csv, ",")!;
  expect(cells(markdown)).toEqual(rows);
  expect(markdown).not.toContain("<script>");
  expect(markdown).toContain("\\|");
  expect(markdown).toContain("<br>");
});
it("keeps delimiter choice deterministic when quoted CSV contains spreadsheet tabs", () => {
  const csv = '"a\tb",c\n"d\te",f';
  expect(cells(clipboardTable(csv)!)).toEqual([
    ["a\tb", "c"],
    ["d\te", "f"],
  ]);
});
it("retains every encoded field of a large clipboard table", () => {
  const rows = Array.from({ length: 500 }, (_, row) =>
    Array.from({ length: 8 }, (_, column) => `${row}:${column}`),
  );
  const source = rows.map((row) => row.join("\t")).join("\n");
  const markdown = clipboardTable(source)!;
  const parsed = parseMarkdownTable(
    markdown.split("\n").map((text) => ({ prefix: "", text })),
  )!;
  const actual = [parsed.table.header, ...parsed.table.body].map(
    (row) => row.cells,
  );
  expect(actual).toEqual(
    rows.map((row) => row.map((value) => value.replace(":", "\\:"))),
  );
  expect(markdown.split("\n")).toHaveLength(rows.length + 1);
});

it("round-trips every CommonMark ASCII punctuation character as literal cell text", () => {
  const punctuation = String.fromCharCode(
    ...Array.from({ length: 94 }, (_, index) => index + 33).filter(
      (value) =>
        (value >= 33 && value <= 47) ||
        (value >= 58 && value <= 64) ||
        (value >= 91 && value <= 96) ||
        (value >= 123 && value <= 126),
    ),
  );
  const csv = '"' + punctuation.replaceAll('"', '""') + '",plain\nvalue,other';
  expect(cells(clipboardTable(csv, ",")!)[0]).toEqual([punctuation, "plain"]);
});
it("preserves empty headers, empty records and normalized embedded line breaks", () => {
  expect(cells(clipboardTable(",\n,", ",")!)).toEqual([
    ["", ""],
    ["", ""],
  ]);
  expect(cells(clipboardTable('Name,Value\n"a\rb","c"', ",")!)).toEqual([
    ["Name", "Value"],
    ["a\nb", "c"],
  ]);
});

it.each([",", "\t"] as const)(
  "infers ragged multi-column records using %j without hiding extra data",
  (separator) => {
    const source = [
      ["Name", "City"],
      ["Alpha", "Dhaka", "extra"],
    ]
      .map((row) => row.join(separator))
      .join("\n");
    expect(cells(clipboardTable(source)!)).toEqual([
      ["Name", "City", ""],
      ["Alpha", "Dhaka", "extra"],
    ]);
  },
);
