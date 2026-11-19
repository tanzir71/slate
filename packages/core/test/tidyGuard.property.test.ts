import { expect, it } from "vitest";
import * as fc from "fast-check";
import { guardFix, preservesContent } from "../src/tidy/index";

const word = fc
  .array(
    fc.constantFrom("a", "b", "c", "বাংলা", "🙂", "零", "café", "e\u0301"),
    { minLength: 1, maxLength: 24 },
  )
  .map((parts) => parts.join(""));
const settings = { seed: 20261119, numRuns: 200 };

it("preserves generated wiki paths containing significant whitespace", () => {
  fc.assert(
    fc.property(word, word, (first, second) => {
      const source = `![[Folder/${first}  ${second}|label]]\n`;
      expect(preservesContent(source, source.replace("  ", " "))).toBe(false);
      expect(
        preservesContent(source + "\n_word_\n", source + "\n*word*\n"),
      ).toBe(true);
    }),
    settings,
  );
});

it("accepts Unicode-preserving marker and spacing changes across generated notes", () => {
  fc.assert(
    fc.property(word, word, (heading, item) => {
      const source = `# ${heading}\n\n+ _${item}_\n`;
      const candidate = `# ${heading}\n\n- *${item}*\n\n`;
      const result = guardFix(source, [
        { from: 0, to: source.length, text: candidate },
      ]);
      expect(result.kind).toBe("applied");
      expect(result.source).toBe(candidate);
    }),
    settings,
  );
});

it("rejects deleting generated words while leaving every original byte available", () => {
  fc.assert(
    fc.property(word, word, (first, second) => {
      const source = `${first} ${second}\n`;
      const result = guardFix(source, [
        { from: first.length + 1, to: source.length - 1, text: "" },
      ]);
      expect(result).toEqual({
        kind: "rejected",
        source,
        reason: "content-change",
      });
    }),
    settings,
  );
});

it("preserves generated code and HTML whitespace literally", () => {
  fc.assert(
    fc.property(word, (content) => {
      for (const source of [
        `\`\`\`txt\n${content}  literal\n\`\`\`\n`,
        `<pre>${content}  literal</pre>\n`,
        `\`${content}  literal\`\n`,
      ]) {
        expect(
          preservesContent(source, source.replace("  literal", " literal")),
        ).toBe(false);
      }
    }),
    settings,
  );
});

it("allows generated YAML presentation changes while rejecting changed values", () => {
  fc.assert(
    fc.property(
      word,
      fc.array(word, { minLength: 1, maxLength: 5 }),
      fc.integer({ min: -1000, max: 1000 }),
      (title, tags, count) => {
        const source = `---\ntitle: ${JSON.stringify(title)}\ntags: ${JSON.stringify(tags)}\ncount: ${count}\n---\nWords\n`;
        const candidate = `---\ncount: ${count}\ntags:\n${tags.map((tag) => `  - ${JSON.stringify(tag)}`).join("\n")}\ntitle: ${JSON.stringify(title)}\n---\nWords\n`;
        expect(preservesContent(source, candidate)).toBe(true);
        expect(
          preservesContent(
            source,
            candidate.replace(`count: ${count}\n`, `count: ${count + 1}\n`),
          ),
        ).toBe(false);
      },
    ),
    settings,
  );
});
