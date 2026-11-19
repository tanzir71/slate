import { expect, it } from "vitest";
import * as fc from "fast-check";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { parseTidyAst } from "../src/tidy/source";

const reference = unified().use(remarkParse).use(remarkGfm).freeze();

it("keeps a proven plain final paragraph out of general token allocation", () => {
  const source = "  #   Draft\n\n" + "Words worth keeping 42 ".repeat(4096) + "End\n";
  const expected = reference.parse(source);
  const original = Array.prototype.push;
  let longestToken = 0;
  Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
    for (const item of items) {
      if (!Array.isArray(item) || item[0] !== "exit") continue;
      const token: unknown = item[1];
      if (typeof token !== "object" || token === null || !("start" in token) || !("end" in token)) continue;
      const start = token.start as { offset?: number } | undefined;
      const end = token.end as { offset?: number } | undefined;
      if (typeof start?.offset === "number" && typeof end?.offset === "number")
        longestToken = Math.max(longestToken, end.offset - start.offset);
    }
    return Reflect.apply(original, this, items) as number;
  };
  let actual: ReturnType<typeof parseTidyAst> | undefined;
  try { actual = parseTidyAst(source); } finally { Array.prototype.push = original; }
  expect(actual).toStrictEqual(expected);
  // A work bound, not a substitute for the unchanged real-worker deadline.
  expect(longestToken).toBeLessThan(256);
});

it("preserves full GFM trees and UTF-16 positions for plain tails after arbitrary blocks", () => {
  const prefix = fc.constantFrom(
    "", "# Heading\n\n", "  #   Draft\n\n", "paragraph\n", "paragraph\n\n", "- item\n", "- item\n\n",
    "> quote\n", "```js\n", "```js\ncode\n```\n", "    code\n\n", "[a]: https://example.test\n\n",
    "[^a]: Footnote\n\n", "<div>\n", "<div>\n\n", "<script>\n", "| A | B |\n|---|---|\n", "---\n",
  );
  const word = fc.array(fc.constantFrom("A", "z", "0", "9", "é", "ব", "া", "中", "𐐀", "\u0301"), { minLength: 1, maxLength: 10 }).map((characters) => characters.join(""));
  const text = fc.array(word, { minLength: 1, maxLength: 15 }).chain((words) => fc.constantFrom(" ", "  ", "   ").map((space) => words.join(space)))
    .map((text) => Array(Math.ceil(4200 / text.length)).fill(text).join(" "));
  fc.assert(fc.property(prefix, text, fc.constantFrom("\n", "\r\n", "\r"), fc.boolean(), (before, tail, eol, finalNewline) => {
    const source = before.replaceAll("\n", eol) + tail + (finalNewline ? eol : "");
    expect(parseTidyAst(source)).toStrictEqual(reference.parse(source));
  }), { seed: 2026111903, numRuns: 500 });
}, 30_000);

it.each([
  "", "\n", "\r\n", "Words\n\n", " Words\n", "Words \n", "Words  \n", "Words\tkept\n", "Words\u00a0kept\n",
  "Words\u0000kept\n", "Words 🙂 kept\n", "Words!\n", "www.example.test\n", "https://example.test\n", "mail@example.test\n",
  "[a]:\nWords\n", "[a]: https://example.test\nWords\n", "[a]: https://example.test\n  \"Title\nWords\n", "[^a]:\nWords\n",
  "# Heading\n---\nWords\n", "| One | Two |\n|---|---|\nWords\n", "- item\nWords\n", "- item\n\nWords\n",
  "> quote\nWords\n", "<script>\nWords\n", "<div>\nWords\n", "<!-- open\nWords\n", "~~~\nWords\n",
  "    code\nWords\n", "\uFEFFWords\n", "*emphasis*\n\nWords\n", "[label][a]\n\n[a]: https://example.test\n\nWords\n",
])("retains every grammar boundary and physical line ending (%s)", (source) => {
  source = source.replace(/Words(?=\n?$)/, "Words ".repeat(1024) + "End");
  expect(parseTidyAst(source)).toStrictEqual(reference.parse(source));
});

it.each([" ", "  ", "\t", "\u00a0", "\u0000", "!", ".", "🙂", "\\", "&", "[", "<", "_", "*", "~", "|", ":", "@"]) (
  "preserves syntax and whitespace interpretation in long tails (%s)", (boundary) => {
    const source = "# Heading\r\n\r\n" + "Word ".repeat(1024) + boundary + "Words\r\n";
    expect(parseTidyAst(source)).toStrictEqual(reference.parse(source));
  },
);

it("retains large prefixes and the exact boundary around the plain-tail work bound", () => {
  for (const length of [4095, 4096, 4097]) {
    for (const prefix of ["", "# Heading\n\n", "Earlier words\n\n".repeat(500)]) {
      const source = prefix + "W".repeat(length) + "\r\n";
      expect(parseTidyAst(source)).toStrictEqual(reference.parse(source));
    }
  }
});
