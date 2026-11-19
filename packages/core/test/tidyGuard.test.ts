import { describe, expect, it } from "vitest";
import { extractWikiLinks } from "../src/index";
import {
  contentProjection,
  guardFix,
  preservesContent,
} from "../src/tidy/index";
import { projectTidyDocument } from "../src/tidy/projection";
import type { TidyNode } from "../src/tidy/source";

describe("Tidy normalized content projection", () => {
  it("retains unknown own keys while normalizing only position, list spread and text whitespace", () => {
    const root = JSON.parse('{"type":"root","position":{"start":1},"data":{"z":null,"constructor":"literal","__proto__":{"kept":true}},"children":[{"type":"list","ordered":false,"start":null,"spread":true,"children":[{"type":"listItem","checked":false,"spread":true,"children":[{"type":"paragraph","children":[{"type":"text","value":"Two  words\\nkept"}]}]}]}]}') as TidyNode;
    const original = JSON.stringify(root);
    expect(projectTidyDocument({ source: "", body: "", bodyFrom: 0, root })).toBe('{"bom":false,"metadata":null,"wiki":[],"markdown":{"children":[{"children":[{"checked":false,"children":[{"children":[{"type":"text","value":"Two words kept"}],"type":"paragraph"}],"type":"listItem"}],"ordered":false,"start":null,"type":"list"}],"data":{"__proto__":{"kept":true},"constructor":"literal","z":null},"type":"root"}}');
    expect(JSON.stringify(root)).toBe(original);
    expect(Object.prototype).not.toHaveProperty("kept");
  });

  it("keeps array order, numeric own keys and absent fields in the canonical projection", () => {
    const root = { type: "root", children: [], data: { "10": "ten", "2": "two", missing: undefined, flags: [true, null, 7], nested: { z: 1, a: 2 } } };
    expect(projectTidyDocument({ source: "", body: "", bodyFrom: 0, root })).toBe('{"bom":false,"metadata":null,"wiki":[],"markdown":{"children":[],"data":{"2":"two","10":"ten","flags":[true,null,7],"nested":{"a":2,"z":1}},"type":"root"}}');
  });

  it("keeps significant whitespace in Slate wiki targets and aliases", () => {
    expect(extractWikiLinks("[[Two  spaces]]")[0]?.target).not.toBe(
      extractWikiLinks("[[Two spaces]]")[0]?.target,
    );
    for (const source of [
      "[[Two  spaces]]\n",
      "[[Folder/My  sheet|Alias]]\n",
      "![[Two  spaces|my  alias]]\n",
      "[[_Two  spaces_]]\n",
    ]) {
      expect(preservesContent(source, source.replaceAll("  ", " "))).toBe(
        false,
      );
      expect(
        preservesContent(source + "\n_word_\n", source + "\n*word*\n"),
      ).toBe(true);
    }
  });

  it("retains overflow table cells even when the header has fewer columns", () => {
    expect(
      preservesContent(
        "a | b\n--- | ---\none | two | keep\n",
        "a | b\n--- | ---\none | two\n",
      ),
    ).toBe(false);
  });

  it("keeps numeric spelling when JavaScript rounding would conceal a changed YAML value", () => {
    const before = "---\ncount: 9007199254740993\n---\nWords\n";
    expect(
      preservesContent(
        before,
        before.replace("9007199254740993", "9007199254740992"),
      ),
    ).toBe(false);
    expect(
      preservesContent(
        "---\ncount: -0\n---\nWords\n",
        "---\ncount: 0\n---\nWords\n",
      ),
    ).toBe(false);
  });

  it("does not reorder YAML keys that collide when front matter becomes JavaScript properties", () => {
    for (const [a, b] of [
      ["1: numeric", '"1": string'],
      ["? [a, b]\n: complex", '"a,b": string'],
    ]) {
      expect(
        preservesContent(
          `---\n${a}\n${b}\n---\nWords\n`,
          `---\n${b}\n${a}\n---\nWords\n`,
        ),
      ).toBe(false);
    }
  });

  it("keeps escaped carriage returns distinct from escaped line feeds in scalar values", () => {
    expect(
      preservesContent(
        '---\ntext: "a\\rb"\n---\nWords\n',
        '---\ntext: "a\\nb"\n---\nWords\n',
      ),
    ).toBe(false);
  });

  it.each([
    ["# Heading\n\n+ one\n+ two\n", "# Heading\n\n- one\n\n- two\n\n"],
    [
      "A  word\nwrap with _em_ and __strong__.\n",
      "A word wrap with *em* and **strong**.\n",
    ],
    ["5. first\n9. second\n", "5. first\n6. second\n"],
    [
      "name | value\n:--- | ---:\none | two\n",
      "| name | value |\n| :--- | ---: |\n| one  | two   |\n",
    ],
    [
      "~~~ts meta\nconst value = 1;\n~~~\n",
      "```ts meta\nconst value = 1;\n```\n",
    ],
    [
      '[a]: https://example.test "A title"\n\n[a]\n',
      "[a]: <https://example.test> 'A title'\n\n[a]\n",
    ],
    [
      "\uFEFF---\ntags: [a,b]\ntitle: 'Hello'\ncount: 2\n---\n# Hello\n",
      "\uFEFF---\ntitle: Hello\ncount: 2\ntags:\n  - a\n  - b\n---\n\n# Hello\n\n",
    ],
  ])("accepts only presentation changes (%s)", (before, after) => {
    expect(preservesContent(before, after)).toBe(true);
    expect(contentProjection(before)).toBe(contentProjection(after));
  });

  it.each([
    ["Words stay.\n", "Words vanish.\n"],
    ["# Heading\n", "## Heading\n"],
    ["#Heading\n", "# Heading\n"],
    ["- [ ] task\n", "- [x] task\n"],
    ["5. first\n6. second\n", "1. first\n2. second\n"],
    [
      '[name](https://example.test "title")\n',
      '[name](https://evil.test "title")\n',
    ],
    ["![alt](image.png)\n", "![new alt](image.png)\n"],
    ["a  \nb\n", "a\nb\n"],
    ["`a  b`\n", "`a b`\n"],
    ["```js meta\na  b\n```\n", "```js meta\na b\n```\n"],
    ["```js meta\na\n```\n", "```ts meta\na\n```\n"],
    ["<div>  words </div>\n", "<div> words </div>\n"],
    ["a | b\n--- | ---\none | two\n", "a | b\n:--- | ---\none | two\n"],
    ["[^a]: original\n\nText[^a].\n", "[^a]: changed\n\nText[^a].\n"],
    ["\uFEFFWords\n", "Words\n"],
    ["---\ntitle: 1\n---\nWords\n", "---\ntitle: '1'\n---\nWords\n"],
    ["---\ntitle: A # keep me\n---\nWords\n", "---\ntitle: A\n---\nWords\n"],
    ["---\ntags: [a, b]\n---\nWords\n", "---\ntags: [b, a]\n---\nWords\n"],
    [
      "---\nx: &a one\ny: *a\n---\nWords\n",
      "---\ny: *a\nx: &a one\n---\nWords\n",
    ],
    ["---\nx: [unfinished\nWords", "---\nx: [finished]\n---\nWords"],
  ])(
    "rejects changes to meaning, structure or protected data (%s)",
    (before, after) => {
      expect(preservesContent(before, after)).toBe(false);
    },
  );

  it("keeps invalid, unknown-tagged and alias-bearing metadata literal while formatting the body", () => {
    for (const metadata of [
      "x: [unfinished",
      "x: !unknown value",
      "x: &a one\ny: *a",
      "x: 1\nx: 2",
    ]) {
      const prefix = `---\n${metadata}\n---\n`;
      expect(preservesContent(prefix + "_word_\n", prefix + "*word*\n")).toBe(
        true,
      );
      expect(
        preservesContent(
          prefix + "Word\n",
          prefix.replace("x:", "x: ") + "Word\n",
        ),
      ).toBe(false);
    }
  });

  it("retains typed YAML edge values and comments while ignoring mapping order", () => {
    const before =
      "---\n# heading\ntitle: A # title comment\nn: .nan\ni: .inf\nflag: true\nempty: null\ntext: |\n  hello\n---\nWords\n";
    const after = before.replace("n: .nan\ni: .inf", "i: .inf\nn: .nan");
    expect(preservesContent(before, after)).toBe(true);
    expect(preservesContent(before, before.replace(".nan", "null"))).toBe(
      false,
    );
    expect(preservesContent(before, before.replace("hello", "goodbye"))).toBe(
      false,
    );
    expect(
      preservesContent(
        before,
        before.replace("title comment", "changed comment"),
      ),
    ).toBe(false);
  });

  it("handles CRLF, CR, EOF and protected unfinished front matter without expanding aliases", () => {
    expect(
      preservesContent(
        "---\r\ntitle: A\r\n---\r\n_word_\r\n",
        "---\ntitle: A\n---\n*word*\n",
      ),
    ).toBe(true);
    expect(
      preservesContent(
        "---\rtitle: A\r...\r_word_",
        "---\ntitle: A\n---\n*word*\n",
      ),
    ).toBe(true);
    expect(preservesContent("---\ntitle: A\n---", "---\ntitle: A\n---\n")).toBe(
      true,
    );
    expect(preservesContent("---\ntitle: A", "---\ntitle: A\n")).toBe(false);
    expect(
      preservesContent(
        "---\nx: &a [*a]\n---\n_word_\n",
        "---\nx: &a [*a]\n---\n*word*\n",
      ),
    ).toBe(true);
  });
});

describe("guarded formatting proposals", () => {
  it("applies multiple original-offset changes atomically and snapshots the accepted changes", () => {
    const source = "_বাংলা 🙂_\n\n+ one\n";
    const list = source.indexOf("+");
    const changes = [
      { from: 0, to: 1, text: "*" },
      {
        from: source.indexOf("_", 1),
        to: source.indexOf("_", 1) + 1,
        text: "*",
      },
      { from: list, to: list + 1, text: "-" },
    ];
    const result = guardFix(source, changes);
    expect(result.kind).toBe("applied");
    expect(result.source).toBe("*বাংলা 🙂*\n\n- one\n");
    changes[0]!.text = "lost";
    if (result.kind === "applied") expect(result.changes[0]!.text).toBe("*");
  });

  it("rejects a mixed safe/unsafe proposal in full without changing the original words", () => {
    const source = "_Keep these words._\n";
    expect(
      guardFix(source, [
        { from: 0, to: 1, text: "*" },
        { from: 6, to: 11, text: "" },
      ]),
    ).toEqual({ kind: "rejected", source, reason: "content-change" });
    expect(source).toBe("_Keep these words._\n");
  });

  it.each([
    [{ from: -1, to: 0, text: "" }],
    [{ from: 0, to: 100, text: "" }],
    [{ from: 1.5, to: 2, text: "" }],
    [
      { from: 1, to: 3, text: "" },
      { from: 2, to: 4, text: "" },
    ],
    [
      { from: 3, to: 4, text: "" },
      { from: 0, to: 1, text: "" },
    ],
  ])(
    "rejects invalid or overlapping spans before editing (%j)",
    (...changes) => {
      const source = "Words";
      expect(guardFix(source, changes)).toEqual({
        kind: "rejected",
        source,
        reason: "invalid-changes",
      });
    },
  );

  it("returns unchanged for empty or identical proposals, including malformed metadata", () => {
    const source = "---\nx: [unfinished";
    expect(guardFix(source, [])).toEqual({ kind: "unchanged", source });
    expect(guardFix(source, [{ from: 0, to: 3, text: "---" }])).toEqual({
      kind: "unchanged",
      source,
    });
  });
});
