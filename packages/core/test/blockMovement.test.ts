import { expect, it } from "vitest";
import {
  scanMarkdownBlocks,
  planMarkdownBlockMove,
} from "../src/blockMovement";
import { applyTextChanges } from "../src/textChanges";

it("finds whole blocks with source positions, including lists, fences and Unicode", () => {
  const source =
    "# 🙂\n\nParagraph **kept**.\n\n- A\n  - child\n- B\n\n~~~rust\n# literal\n~~~\n\n| A | B |\n| - | - |\n| 1 | 2 |";
  const document = scanMarkdownBlocks(source);
  expect(document.blocks.map((block) => block.kind)).toEqual([
    "heading",
    "paragraph",
    "list",
    "code",
    "table",
  ]);
  expect(document.blocks.map(({ from, to }) => source.slice(from, to))).toEqual(
    [
      "# 🙂",
      "Paragraph **kept**.",
      "- A\n  - child\n- B",
      "~~~rust\n# literal\n~~~",
      "| A | B |\n| - | - |\n| 1 | 2 |",
    ],
  );
});

it.each(["\n", "\r\n", "\r"])(
  "moves whole payloads and keeps the surrounding source with %j",
  (eol) => {
    const source = ["# First", "", "> quoted", "> words", "", "Last 🙂"].join(
      eol,
    );
    const document = scanMarkdownBlocks(source);
    const plan = planMarkdownBlockMove(document, 2, 0)!;
    const moved = applyTextChanges(source, plan.changes);
    expect(moved).toBe(
      ["Last 🙂", "", "# First", "", "> quoted", "> words"].join(eol),
    );
    expect(moved.slice(plan.selection.anchor, plan.selection.head)).toBe(
      "Last 🙂",
    );
  },
);

it.each([
  [0, 3, "B\n\nC\n\nA"],
  [1, 0, "B\n\nA\n\nC"],
  [1, 3, "A\n\nC\n\nB"],
  [2, 1, "A\n\nC\n\nB"],
])("reorders block %i before slot %i", (index, before, expected) => {
  const source = "A\n\nB\n\nC";
  const plan = planMarkdownBlockMove(
    scanMarkdownBlocks(source),
    index,
    before,
  )!;
  expect(applyTextChanges(source, plan.changes)).toBe(expected);
});

it.each(["---", "..."])(
  "protects BOM and front matter ending in %s",
  (closing) => {
    const prefix = "\uFEFF---\ntitle: Notes\n" + closing + "\n\n";
    const source = prefix + "First\n\nSecond";
    const document = scanMarkdownBlocks(source);
    expect(document.blocks).toHaveLength(2);
    const plan = planMarkdownBlockMove(document, 1, 0)!;
    expect(applyTextChanges(source, plan.changes)).toBe(
      prefix + "Second\n\nFirst",
    );
  },
);
it("retains a BOM when the first body block moves", () => {
  const source = "\uFEFFFirst\n\nSecond";
  const plan = planMarkdownBlockMove(scanMarkdownBlocks(source), 0, 2)!;
  expect(applyTextChanges(source, plan.changes)).toBe("\uFEFFSecond\n\nFirst");
});
it.each([
  "Title\n=====",
  "- Parent\n  - nested child\n- Other",
  "~~~rust\n# literal\n~~~",
  "    indented code\n    more",
  "<div>\nHTML bytes\n</div>",
  "<!-- comment -->",
  "| A | B |\n| - | - |\n| C | D |",
  "[ref]: https://example.org",
])("moves the entire %j payload, preserving its exact contents", (payload) => {
  const source = "Intro\n\n" + payload + "\n\nTail";
  const document = scanMarkdownBlocks(source);
  expect(document.blocks).toHaveLength(3);
  for (let index = 1; index < document.blocks.length; index++)
    expect(document.blocks[index - 1]!.to).toBeLessThanOrEqual(
      document.blocks[index]!.from,
    );
  const plan = planMarkdownBlockMove(document, 1, 0)!;
  expect(applyTextChanges(source, plan.changes)).toBe(
    payload + "\n\nIntro\n\nTail",
  );
});
it("does not reinterpret a moved divider as unfinished first-line metadata", () => {
  const document = scanMarkdownBlocks("Intro\n\n---\n\nTail");
  expect(planMarkdownBlockMove(document, 1, 0)).toBeUndefined();
});
it("preserves trailing newlines and creates boundaries between formerly adjacent block types", () => {
  const source = "# H\nWords\n\nLast\n";
  const plan = planMarkdownBlockMove(scanMarkdownBlocks(source), 0, 3)!;
  expect(applyTextChanges(source, plan.changes)).toBe("Words\n\nLast\n\n# H\n");
});
it("leaves incomplete YAML and empty documents without movable blocks", () => {
  for (const source of [
    "",
    " \n",
    "---",
    "---\ntitle: Still writing",
    "\uFEFF---\nunfinished",
  ]) {
    expect(scanMarkdownBlocks(source).blocks).toEqual([]);
  }
});
it("ignores same-position moves and rejects invalid block indexes", () => {
  const document = scanMarkdownBlocks("A\n\nB");
  expect(planMarkdownBlockMove(document, 0, 0)).toBeUndefined();
  expect(planMarkdownBlockMove(document, 0, 1)).toBeUndefined();
  for (const [index, before] of [
    [-1, 0],
    [0, -1],
    [2, 0],
    [0, 3],
    [0.5, 1],
    [0, Number.NaN],
  ])
    expect(() => planMarkdownBlockMove(document, index!, before!)).toThrow(
      RangeError,
    );
});
