import { expect, it } from "vitest";
import { readCustomBlock, planCustomBlock } from "../src/customBlocks";
import { applyTextChanges } from "../src/textChanges";

it("derives a stable file identity and searchable names without interpreting fragment metadata", () => {
  const source =
    "\uFEFF---\nname: Literal property\n---\n{{prompt:Name}} ${1:Text} $0\n";
  expect(readCustomBlock(source, ".slate/blocks/Meetings/Review.md")).toEqual({
    id: "custom:.slate/blocks/Meetings/Review.md",
    path: ".slate/blocks/Meetings/Review.md",
    label: "Review",
    description: "Meetings/Review.md",
    aliases: ["Meetings/Review", "Review"],
    group: "Blocks",
    placement: "block",
    source,
  });
  expect(readCustomBlock("", ".slate/blocks/বাংলা 🙂.MD").label).toBe(
    "বাংলা 🙂",
  );
});

it.each([
  "Quote.md",
  ".slate/templates/Quote.md",
  ".slate/blocks/.md",
  ".slate/blocks/../Quote.md",
  ".slate/blocks//Quote.md",
  ".slate/blocks/./Quote.md",
  ".slate/blocks/Quote.txt",
  ".slate/blocks/Quote.md/",
  ".slate/blocks/Quote:copy.md",
  ".slate/blocks/Quote\\copy.md",
  ".slate/blocks/Quote\u0000.md",
  ".slate/blocks/Quote\u007f.md",
])("rejects a noncanonical fragment path: %j", (path) => {
  expect(() => readCustomBlock("Text", path)).toThrow(".slate/blocks/");
});

it("bounds fragment size before parsing or inserting and keeps an explicitly empty file valid", () => {
  expect(readCustomBlock("", ".slate/blocks/Empty.md").source).toBe("");
  expect(() =>
    readCustomBlock("x".repeat(1_048_577), ".slate/blocks/Large.md"),
  ).toThrow("1 MiB");
});

it.each(["é", "🙂"])(
  "uses the UTF-8 byte limit for %s rather than its UTF-16 length",
  (character) => {
    const count = character === "é" ? 524_288 : 262_144;
    expect(
      readCustomBlock(character.repeat(count), ".slate/blocks/Unicode.md")
        .source.length,
    ).toBe(character.length * count);
    expect(() =>
      readCustomBlock(character.repeat(count + 1), ".slate/blocks/Unicode.md"),
    ).toThrow("1 MiB");
  },
);

it("checks the same size guard on a fragment supplied directly to the insertion planner", () => {
  expect(() =>
    planCustomBlock(
      { source: "আ".repeat(349_526) },
      { source: "/q", from: 0, to: 2 },
    ),
  ).toThrow("1 MiB");
});

it.each([
  {
    source: "/quote",
    from: 0,
    to: 6,
    fragment: "> Quote",
    output: "> Quote",
    cursor: 7,
  },
  {
    source: "Before /quote after",
    from: 7,
    to: 13,
    fragment: "> Quote",
    output: "Before \n\n> Quote\n\n after",
    cursor: 16,
  },
  {
    source: "Before\n\n/quote\n\nAfter",
    from: 8,
    to: 14,
    fragment: "> Quote\n",
    output: "Before\n\n> Quote\n\n\nAfter",
    cursor: 16,
  },
  {
    source: "A\r\n\r\n/q\r\n\r\nB",
    from: 5,
    to: 7,
    fragment: "One\nTwo",
    output: "A\r\n\r\nOne\r\nTwo\r\n\r\nB",
    cursor: 13,
  },
  {
    source: "A\r\r/q\r\rB",
    from: 3,
    to: 5,
    fragment: "One\r\nTwo",
    output: "A\r\rOne\rTwo\r\rB",
    cursor: 10,
  },
  {
    source: "🙂 /q",
    from: 3,
    to: 5,
    fragment: "বাংলা 🙂",
    output: "🙂 \n\nবাংলা 🙂",
    cursor: 13,
  },
  {
    source: "Keep /q text",
    from: 5,
    to: 7,
    fragment: "",
    output: "Keep  text",
    cursor: 5,
  },
])(
  "plans one exact fragment replacement with document line endings: $source",
  ({ source, from, to, fragment, output, cursor }) => {
    const block = readCustomBlock(fragment, ".slate/blocks/Quote.md"),
      plan = planCustomBlock(block, { source, from, to });
    expect(plan.kind).toBe("insert");
    expect(plan.changes).toHaveLength(1);
    expect(applyTextChanges(source, plan.changes)).toBe(output);
    expect(plan.selection).toEqual({ anchor: cursor, head: cursor });
    expect(block.source).toBe(fragment);
  },
);

it("removes only the fragment's file BOM while retaining its literal YAML, variables and tab syntax", () => {
  const source = "\uFEFF---\r\nname: Kept\r\n---\r\n{{date}} ${1:Name}$0\r\n",
    block = readCustomBlock(source, ".slate/blocks/Literal.md");
  const plan = planCustomBlock(block, { source: "/literal", from: 0, to: 8 });
  expect(applyTextChanges("/literal", plan.changes)).toBe(
    "---\nname: Kept\n---\n{{date}} ${1:Name}$0\n",
  );
  expect(block.source).toBe(source);
});

it.each([
  [-1, 0],
  [2, 1],
  [0, 4],
  [0.5, 1],
  [0, NaN],
  [Infinity, Infinity],
])("rejects invalid replacement coordinates %j", (from, to) => {
  const block = readCustomBlock("Text", ".slate/blocks/Quote.md");
  expect(() => planCustomBlock(block, { source: "abc", from, to })).toThrow(
    RangeError,
  );
});

it("keeps the note BOM adjacent to the first inserted content", () => {
  const source = "\uFEFF---\nname: Kept\n---\n{{date}}\n";
  const block = readCustomBlock(source, ".slate/blocks/Metadata.md");
  const plan = planCustomBlock(block, { source: "\uFEFF/q", from: 1, to: 3 });
  expect(applyTextChanges("\uFEFF/q", plan.changes)).toBe(source);
  expect(plan.selection).toEqual({
    anchor: source.length,
    head: source.length,
  });
});
