import { describe, expect, it } from "vitest";
import { applyTextChanges } from "../src/textChanges";
import {
  fix,
  lint,
  preservesContent,
  readTidyConfiguration,
  tidyRuleIds,
  type TidyRuleId,
} from "../src/tidy/index";

function only(rules: readonly TidyRuleId[], keepHardBreaks = true) {
  return readTidyConfiguration(
    JSON.stringify({
      version: 1,
      keepHardBreaks,
      rules: Object.fromEntries(
        tidyRuleIds.map((id) => [id, rules.includes(id)]),
      ),
    }),
  );
}
describe("individual Tidy rule behavior", () => {
  it("normalizes empty bullet items together with populated siblings", () => {
    const source = "*\n* next\n",
      result = fix(source, only(["list-marker"]));
    expect(result.output).toBe("-\n- next\n");
    expect(preservesContent(source, result.output)).toBe(true);
  });
  it("handles overlapping table alignment and URL repairs without losing either request", () => {
    const source = "link|value\n---|---\nhttps://example.test|one\n",
      config = only(["table-align", "bare-urls"]);
    const result = fix(source, config);
    expect(result.output).toContain("<https://example.test>");
    expect(
      result.output
        .trimEnd()
        .split("\n")
        .every((line) => line.startsWith("| ") && line.endsWith(" |")),
    ).toBe(true);
    expect(preservesContent(source, result.output)).toBe(true);
    expect(fix(result.output, config).output).toBe(result.output);
  });
  it("satisfies overlapping whitespace repairs together while retaining individually selectable issues", () => {
    const source = "Words \t\n\n\n",
      report = lint(source),
      result = fix(source);
    expect(result.output).toBe("Words\n");
    expect(result.issues).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
    expect(new Set(result.applied.map((issue) => issue.id))).toEqual(
      new Set(report.issues.map((issue) => issue.id)),
    );
    const tabs = report.issues
      .filter((issue) => issue.rule === "no-hard-tabs")
      .map((issue) => issue.id);
    expect(fix(source, undefined, tabs).output).toBe("Words   \n\n\n");
  });
  it("normalizes list and heading indentation inside quotes without changing quote membership", () => {
    const source = ">   #   Heading\n>\n> * one\n>     * two\n";
    expect(
      fix(source, only(["heading-start-left", "list-indent"])).output,
    ).toBe("> #   Heading\n>\n> * one\n>   * two\n");
  });
  it("aligns quoted tables with varying optional spaces after the quote marker", () => {
    const source = "> a|b\n>---|---\n>1|2\n";
    const result = fix(source, only(["table-align"]));
    expect(result.output).toBe(
      "> | a   | b   |\n>| --- | --- |\n>| 1   | 2   |\n",
    );
    expect(preservesContent(source, result.output)).toBe(true);
  });
  it.each([
    ["heading-space", "#   Heading\n", "# Heading\n"],
    ["heading-start-left", "  # Heading\n", "# Heading\n"],
    [
      "blanks-around-headings",
      "Before\n# Heading\nAfter\n",
      "Before\n\n# Heading\n\nAfter\n",
    ],
    ["list-marker", "* one\n* two\n", "- one\n- two\n"],
    [
      "list-indent",
      "* one\n    * two\n        * three\n",
      "* one\n  * two\n    * three\n",
    ],
    ["ol-prefix", "7. one\n7. two\n13. three\n", "7. one\n8. two\n9. three\n"],
    ["list-marker-space", "-   one\n-  two\n", "- one\n- two\n"],
    [
      "blanks-around-lists",
      "Before\n- one\n# Next\n",
      "Before\n\n- one\n\n# Next\n",
    ],
    [
      "blanks-around-fences",
      "Before\n```js\ncode\n```\nAfter\n",
      "Before\n\n```js\ncode\n```\n\nAfter\n",
    ],
    ["emphasis-style", "_word_\n", "*word*\n"],
    ["strong-style", "__word__\n", "**word**\n"],
    ["trailing-space", "word \nnext \n", "word\nnext\n"],
    ["no-hard-tabs", "word\tword\n", "word  word\n"],
    ["multiple-blanks", "one\n\n\n\nnext\n", "one\n\nnext\n"],
    ["final-newline", "Words\n\n", "Words\n"],
    [
      "table-pipes",
      "one|two\n---|---\nA|B\n",
      "| one|two |\n| ---|--- |\n| A|B |\n",
    ],
    [
      "table-align",
      "one|two\n---|---\nA|B\n",
      "| one | two |\n| --- | --- |\n| A   | B   |\n",
    ],
    [
      "yaml-style",
      "---\nz: keep\ntags:\n - a\n - b\ndate: 2026-11-17\ntitle: Hello\n---\nWords\n",
      "---\ntitle: Hello\ndate: 2026-11-17\ntags: [a, b]\nz: keep\n---\nWords\n",
    ],
    [
      "bare-urls",
      "See https://example.test/path.\n",
      "See <https://example.test/path>.\n",
    ],
  ] as const)(
    "%s produces its requested change and is stable afterward",
    (rule, source, expected) => {
      const config = only([rule]),
        report = lint(source, config),
        result = fix(source, config);
      expect(report.issues.some((issue) => issue.rule === rule)).toBe(true);
      expect(result.output).toBe(expected);
      expect(result.applied.length).toBeGreaterThan(0);
      expect(preservesContent(source, result.output)).toBe(true);
      expect(applyTextChanges(source, result.changes)).toBe(expected);
      expect(fix(expected, config).output).toBe(expected);
    },
  );
  it.each([
    ["heading-increment", "# One\n\n### Three\n"],
    ["fence-language", "```\ncode\n```\n"],
    ["table-columns", "a | b\n--- | ---\none | two | keep\n"],
    ["no-space-in-emphasis", "* word *\n"],
  ] as const)(
    "%s reports a manual warning and preserves every byte",
    (rule, source) => {
      const config = only([rule]);
      expect(
        lint(source, config).issues.some(
          (issue) => issue.rule === rule && !issue.changes.length,
        ),
      ).toBe(true);
      expect(fix(source, config).output).toBe(source);
    },
  );
});
it("preserves actual hard breaks or uses an equivalent backslash when spaces are disabled", () => {
  const source = "word   \nnext\n";
  expect(fix(source, only(["trailing-space"])).output).toBe("word  \nnext\n");
  const result = fix(source, only(["trailing-space"], false));
  expect(result.output).toBe("word\\\nnext\n");
  expect(preservesContent(source, result.output)).toBe(true);
});
it("formats around literal code and wiki paths while leaving their contents exact", () => {
  const source =
    "_word `code\tvalue`_ then\tword and [[Two  spaces]]\n\n```txt\nliteral\tdata  \n```\n";
  const result = fix(
    source,
    only(["emphasis-style", "no-hard-tabs", "trailing-space"]),
  );
  expect(result.output).toBe(
    "*word `code\tvalue`* then  word and [[Two  spaces]]\n\n```txt\nliteral\tdata  \n```\n",
  );
  expect(preservesContent(source, result.output)).toBe(true);
});
it("uses an explicit selection of original issue IDs and maps across earlier edits", () => {
  const source = "---\nz: keep\ntitle: Hello\n---\n##    First\n\n_word_\n";
  const config = only(["yaml-style", "heading-space", "emphasis-style"]),
    report = lint(source, config);
  const selected = report.issues
    .filter((issue) => issue.rule !== "emphasis-style")
    .map((issue) => issue.id);
  const result = fix(source, config, selected);
  expect(result.output).toBe(
    "---\ntitle: Hello\nz: keep\n---\n## First\n\n_word_\n",
  );
  expect(result.applied).toHaveLength(2);
  expect(fix(source, config, []).output).toBe(source);
});
it("rejects unsafe YAML restyling and literal final-newline changes without blocking independent repairs", () => {
  const source =
    "---\nz: &a one\ny: *a\ntitle: Hello\n---\n#   Heading\n\n```txt\nliteral\n\n";
  const result = fix(
    source,
    only(["yaml-style", "heading-space", "final-newline"]),
  );
  expect(result.output).toBe(source.replace("#   Heading", "# Heading"));
  expect(
    result.rejected.some(
      ({ issue, reason }) =>
        issue.rule === "yaml-style" && reason === "content-change",
    ),
  ).toBe(true);
  expect(
    result.rejected.some(
      ({ issue, reason }) =>
        issue.rule === "final-newline" && reason === "content-change",
    ),
  ).toBe(true);
  expect(preservesContent(source, result.output)).toBe(true);
});
it("retains BOM and CRLF through independent fixes and leaves clean/empty input stable", () => {
  const source = "\uFEFF  #   বাংলা 🙂\r\n\r\n_word_\r\n";
  const result = fix(
    source,
    only(["heading-start-left", "heading-space", "emphasis-style"]),
  );
  expect(result.output).toBe("\uFEFF# বাংলা 🙂\r\n\r\n*word*\r\n");
  expect(preservesContent(source, result.output)).toBe(true);
  for (const clean of ["", "\uFEFF", "# Heading\n\nWords.\n"]) {
    expect(lint(clean).issues).toHaveLength(0);
    expect(fix(clean).output).toBe(clean);
    expect(fix(clean).changes).toEqual([]);
  }
});
it("can ignore a rule while applying the remaining requested conventions", () => {
  const config = readTidyConfiguration(
    '{"version":1,"rules":{"emphasis-style":false}}',
  );
  const source = "#   Heading\n\n_word_\n";
  expect(fix(source, config).output).toBe("# Heading\n\n_word_\n");
});
