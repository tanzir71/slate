import { expect, it } from "vitest";
import * as fc from "fast-check";
import { applyTextChanges } from "../src/textChanges";
import {
  fix,
  preservesContent,
  readTidyConfiguration,
} from "../src/tidy/index";

const word = fc
  .array(fc.constantFrom("alpha", "বাংলা", "🙂", "零", "café", "e\u0301"), {
    minLength: 1,
    maxLength: 6,
  })
  .map((parts) => parts.join(""));
it("keeps mixed-document formatting idempotent, content-preserving and exact across presets and line endings", () => {
  fc.assert(
    fc.property(
      word,
      word,
      fc.constantFrom("\n", "\r\n", "\r"),
      fc.constantFrom("slate", "github", "minimal"),
      (first, second, eol, preset) => {
        const literal = `${first}\t  literal  `,
          wiki = `[[Folder/${first}  ${second}|Alias]]`;
        const source = [
          "---",
          "z: keep",
          "count: 9007199254740993",
          `title: ${JSON.stringify(first)}`,
          "tags: [a,b]",
          "---",
          `  #   ${first}`,
          `${first}\t${second}`,
          "",
          `+ _${first}_`,
          `    + __${second}__`,
          "",
          "a|b",
          "---|---",
          `${first}|${second}`,
          "",
          "```txt",
          literal,
          "```",
          "",
          wiki,
          "",
          "<div>raw  data</div>",
          "",
        ].join(eol);
        const config = readTidyConfiguration(
          JSON.stringify({ version: 1, preset }),
        );
        const result = fix(source, config);
        expect(result.applied.length).toBeGreaterThan(0);
        expect(preservesContent(source, result.output)).toBe(true);
        expect(applyTextChanges(source, result.changes)).toBe(result.output);
        expect(result.output).toContain(literal);
        expect(result.output).toContain(wiki);
        expect(result.output).toContain("9007199254740993");
        expect(fix(result.output, config).output).toBe(result.output);
      },
    ),
    { seed: 20261119, numRuns: 200 },
  );
}, 30000);
