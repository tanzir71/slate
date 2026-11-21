import { expect, it } from "vitest";
import * as fc from "fast-check";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { parseTidyAst } from "../src/tidy/source";

const reference = unified().use(remarkParse).use(remarkGfm).freeze();

it("builds word-only paragraphs without general Markdown token events", () => {
  const source = Array(500).fill("Words worth keeping 42").join("\n\n") + "\n";
  const expected = reference.parse(source), original = Array.prototype.push;
  let events = 0;
  Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
    for (const item of items) {
      if (!Array.isArray(item) || !["enter", "exit"].includes(String(item[0]))) continue;
      const token: unknown = item[1];
      if (token && typeof token === "object" && "type" in token && token.type === "paragraph") events++;
    }
    return Reflect.apply(original, this, items) as number;
  };
  let actual: ReturnType<typeof parseTidyAst> | undefined;
  try { actual = parseTidyAst(source); } finally { Array.prototype.push = original; }
  expect(actual).toStrictEqual(expected);
  // A deterministic work bound; the real worker's unchanged deadline is separate.
  expect(events).toBe(0);
});

it("matches full GFM trees and UTF-16 positions across blank lines and mixed EOLs", () => {
  const word = fc.array(fc.constantFrom("A", "z", "0", "9", "é", "ব", "া", "中", "𐐀", "\u0301"), { minLength: 1, maxLength: 12 }).map(chars => chars.join(""));
  const text = fc.array(word, { minLength: 1, maxLength: 10 }).chain(words => fc.constantFrom(" ", "  ", "   ").map(space => words.join(space)));
  const eol = fc.constantFrom("\n", "\r\n", "\r");
  fc.assert(fc.property(
    fc.array(eol, { maxLength: 3 }),
    fc.array(fc.tuple(text, fc.array(eol, { minLength: 2, maxLength: 5 })), { minLength: 1, maxLength: 20 }),
    fc.array(eol, { maxLength: 3 }),
    (leading, paragraphs, trailing) => {
      const source = leading.join("") + paragraphs.map(([value, gap], index) => value + (index + 1 < paragraphs.length ? gap.join("") : "")).join("") + trailing.join("");
      expect(parseTidyAst(source)).toStrictEqual(reference.parse(source));
    },
  ), { seed: 2026112101, numRuns: 500 });
}, 30_000);

it.each([
  "", "\n", "\r\n\r", "Words\ncontinued\n", "Words\r\ncontinued\r", " Words\n", "Words \n", "Words  \n", "Words\tkept\n", "Words\u00a0kept\n",
  "Words\u0000kept\n", "Words 🙂 kept\n", "Words!\n", "www.example.test\n", "https://example.test\n", "mail@example.test\n",
  "# Heading\n\nWords\n", "Words\n---\n", "Words\n===\n", "- Words\n", "> Words\n", "    Words\n", "```\nWords\n```\n",
  "[a]: https://example.test\n\nWords\n", "[^a]: Words\n", "<div>\n\nWords\n", "<!-- open\n\nWords\n", "| Words |\n|---|\n",
  "*Words*\n", "[Words](example.test)\n", "Words &amp; more\n", "Words\\*\n", "$Words$\n", "\uFEFFWords\n",
])("retains full parsing for syntax, adjacent lines and whitespace (%s)", source => {
  expect(parseTidyAst(source)).toStrictEqual(reference.parse(source));
});
