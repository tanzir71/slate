import { expect, it } from "vitest";
import * as fc from "fast-check";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { parseTidyAst } from "../src/tidy/source";

const reference = unified().use(remarkParse).use(remarkGfm).freeze();

it("builds a plain list without allocating general Markdown token events", () => {
  const source = Array(600).fill("+ Words worth keeping 42").join("\n") + "\n";
  const expected = reference.parse(source);
  const original = Array.prototype.push;
  let events = 0;
  // A mock's own call tracking uses push. Count directly and restore in finally.
  Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
    for (const item of items) {
      if (!Array.isArray(item)) continue;
      const event: readonly unknown[] = item;
      if ((event[0] === "enter" || event[0] === "exit") && typeof event[1] === "object" && event[1] !== null && "type" in event[1] && String(event[1].type).startsWith("list")) events++;
    }
    return Reflect.apply(original, this, items) as number;
  };
  let tree: ReturnType<typeof parseTidyAst> | undefined;
  try { tree = parseTidyAst(source); } finally { Array.prototype.push = original; }
  expect(tree).toStrictEqual(expected);
  // Operation count, not a unit wall-clock deadline. Real worker budgets remain mandatory.
  expect(events).toBe(0);
});

it("matches complete GFM nodes and UTF-16 positions for plain lists and mixed physical line endings", () => {
  const word = fc.array(fc.constantFrom("A", "z", "0", "9", "é", "ব", "া", "中", "𐐀", "\u0301"), { minLength: 1, maxLength: 16 }).map((characters) => characters.join(""));
  const text = fc.array(word, { minLength: 1, maxLength: 10 }).chain((words) => fc.constantFrom(" ", "  ", "   ").map((space) => words.join(space)));
  fc.assert(fc.property(
    fc.constantFrom("-", "+", "*"),
    fc.array(fc.tuple(text, fc.constantFrom("\n", "\r\n", "\r")), { minLength: 1, maxLength: 35 }),
    fc.boolean(),
    (marker, lines, finalNewline) => {
      const source = lines.map(([value, eol], index) => marker + " " + value + (index < lines.length - 1 || finalNewline ? eol : "")).join("");
      expect(parseTidyAst(source)).toStrictEqual(reference.parse(source));
    },
  ), { seed: 2026111902, numRuns: 400 });
}, 30_000);

it.each([
  "+ One\n- Two\n",
  "- One\n\n- Two\n",
  "- One\n  continuation\n",
  "- One\n  - Child\n",
  "- [ ] Task\n- [x] Done\n",
  "- www.example.test\n",
  "- https://example.test\n",
  "- _Words_ and **meaning**\n",
  "- `literal`\n",
  "- escaped\\*\n",
  "- <div>Words</div>\n",
  "---\ntitle: Words\n---\n- One\n",
  "- One  \n- Two\n",
  "-  One\n- Two\n",
  "- One\u00a0two\n",
  "- One\u0000two\n",
  "-\n- Two\n",
  "- One\n\n",
  "1. One\n2. Two\n",
  "- One.\n- Two!\n",
  "\uFEFF- One\n- Two\n",
  "- One\r\n\n- Two\n",
  "- 1. Nested\n",
  "- ---\n",
])("preserves the full parser's interpretation at grammar boundaries (%s)", (source) => {
  expect(parseTidyAst(source)).toStrictEqual(reference.parse(source));
});
