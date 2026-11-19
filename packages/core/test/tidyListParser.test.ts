import { expect, it, vi } from "vitest";
import * as fc from "fast-check";
import {
  fromMarkdown,
  type Options as LegacyOptions,
} from "mdast-util-from-markdown-reference";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { parseTidyAst } from "../src/tidy/source";

// Keep the prior released parser as a test-only independent compatibility oracle.
const reference = unified().use(remarkParse).use(remarkGfm).freeze();
const legacyOptions = {
  extensions: reference.data("micromarkExtensions") ?? [],
  mdastExtensions: reference.data("fromMarkdownExtensions") ?? [],
};
// GFM 4 supports both parser versions. Its unchanged hooks use the 2.0 context;
// bridge the new optional listener types only at this independent legacy oracle.
const oldTree = (source: string) =>
  fromMarkdown(source, legacyOptions as unknown as LegacyOptions);

function listItemEvent(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const event: readonly unknown[] = value;
  const token = event[1];
  return (
    (event[0] === "enter" || event[0] === "exit") &&
    typeof token === "object" &&
    token !== null &&
    "type" in token &&
    token.type === "listItem"
  );
}

it("builds a long list without quadratic per-item event-array shifts", () => {
  const count = 600;
  const source = Array(count).fill("+ Words worth keeping.").join("\n");
  const original = Array.prototype.splice;
  let shifted = 0;
  const spy = vi.spyOn(Array.prototype, "splice").mockImplementation(function (
    this: unknown[],
    ...args: [number, number?, ...unknown[]]
  ) {
    const insertsListItem = args.slice(2).some(listItemEvent);
    if (insertsListItem)
      shifted += Math.max(0, this.length - args[0] - (args[1] ?? 0));
    return Reflect.apply(original, this, args) as unknown[];
  });
  let tree: ReturnType<typeof parseTidyAst> | undefined;
  try {
    tree = parseTidyAst(source);
  } finally {
    spy.mockRestore();
  }
  expect(tree).toStrictEqual(oldTree(source));
  // Count array movement rather than a noisy wall-clock unit-test deadline.
  expect(shifted).toBeLessThanOrEqual(count * 32);
});

it("retains the prior GFM tree and positions across generated list boundaries", () => {
  const block = fc.constantFrom(
    "+ First\n+ Second",
    "- [ ] Task\n- [x] Done",
    "1. One\n2. Two",
    "1) Parent\n   - Child\n     > Quote",
    "> - Quoted\n>\n> - Loose",
    "- First\n\n  Second paragraph\n\n- Last",
    "*\n* Empty item",
    "- First\n  continuation\n\nParagraph",
    "- `literal` and _emphasis_",
    "- &amp; [link](https://example.test)\n- ~~deleted~~",
    "---\n\n- List",
    "| A | B |\n| - | - |\n| 1 | 2 |",
    "- Text[^a]\n\n[^a]: Footnote",
    "- ```txt\n  code\n  ```",
    "- <div>literal</div>",
    "- বাংলা 🙂\n  - [[Path|Alias]]",
    "    indented code\n\n- list",
  );
  fc.assert(
    fc.property(
      fc.array(block, { minLength: 1, maxLength: 14 }),
      fc.constantFrom("\n", "\r\n", "\r"),
      (blocks, eol) => {
        const source = blocks.join("\n\n").replace(/\n/g, eol);
        expect(parseTidyAst(source)).toStrictEqual(oldTree(source));
      },
    ),
    { seed: 2026111901, numRuns: 600 },
  );
}, 30_000);
