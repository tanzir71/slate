import { expect, it } from "vitest";
import * as fc from "fast-check";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { parseTidyAst } from "../src/tidy/source";

const reference = unified().use(remarkParse).use(remarkGfm).freeze();
it.each([
  "plain words\n\nAnother paragraph.\n",
  "- one\n  - child\n\n- second\n",
  "1. first\n2. second\n",
  "_word_ and **strong**\n",
  "> quote\n>\n> second paragraph\n",
  "```js\nconst value = 1;\n```\n",
  "a|b\n:---|---:\n1|2\n",
  "- [ ] task\n- [x] complete\n",
  "~one~ and ~~two~~\n",
  "See https://example.test and WWW.example.test\n",
  "one@example.test\n",
  "w\\ww.example.test and www&#46;example.test\n",
  "Text[^a].\n\n[^a]: A footnote.\n",
  '[label][a]\n\n[a]: https://example.test "Title"\n',
  "<script>literal  data</script>\n",
  "[[Folder/Two  spaces]]\n",
])("retains the exact full-GFM tree, including positions (%s)", (source) => {
  expect(parseTidyAst(source)).toEqual(reference.parse(source));
});
it("matches full GFM for generated CommonMark block combinations and physical line endings", () => {
  const block = fc.constantFrom(
    "Plain বাংলা 🙂 words.",
    "## Heading\nText",
    "- item\n  - child",
    "1. ordered\n1. next",
    "> Quote\n>\n> paragraph",
    "_em_ and **strong**",
    "```js\nlet value = 1;\n```",
    "word  \nnext",
    "   indented paragraph",
    "    code",
    "#Heading",
  );
  fc.assert(
    fc.property(
      fc.array(block, { minLength: 1, maxLength: 12 }),
      fc.constantFrom("\n", "\r\n", "\r"),
      (blocks, eol) => {
        const source = blocks.join("\n\n").replace(/\n/g, eol);
        expect(parseTidyAst(source)).toEqual(reference.parse(source));
      },
    ),
    { seed: 20261119, numRuns: 400 },
  );
}, 30000);
