import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { expect, it } from "vitest";
import { slateMarkdownSyntax } from "../src/markdownSyntax";

function mathNodes(source: string) {
  const state = EditorState.create({ doc: source, extensions: [markdown({ extensions: slateMarkdownSyntax })] });
  const nodes: { kind: string; from: number; to: number; source: string; marks: string[]; body: string }[] = [];
  syntaxTree(state).iterate({ enter(reference) {
    if (!/^SlateMath(?:Inline|Block)$/.test(reference.name)) return;
    const node = reference.node;
    nodes.push({ kind: node.name, from: node.from, to: node.to, source: state.sliceDoc(node.from, node.to),
      marks: node.getChildren("SlateMathMark").map(mark => state.sliceDoc(mark.from, mark.to)),
      body: node.getChildren("SlateMathText").map(text => state.sliceDoc(text.from, text.to)).join("\n") });
    return false;
  } });
  expect(state.doc.toString()).toBe(source);
  return nodes;
}

it.each(["$x+y$", "$$x+y$$", String.raw`$a\$b$`, "$x\ny$", "$\\frac{1}{2}$"])("recognizes exact inline math source without parsing its contents as Markdown: %j", formula => {
  const source = "Before " + formula + " after", nodes = mathNodes(source);
  expect(nodes).toHaveLength(1);
  expect(nodes[0]).toMatchObject({ kind: "SlateMathInline", from: 7, to: 7 + formula.length, source: formula });
  expect(nodes[0]!.marks).toEqual(formula.startsWith("$$") ? ["$$", "$$"] : ["$", "$"]);
});

it.each(["$", "$unfinished", String.raw`\$literal$`, "$ spaced $", "$two dollars $30", "Costs $20 and $30.", "`$code$`", "```tex\n$x$\n```", "    $code$", "<div>\n$x$\n</div>"])("keeps incomplete, currency, escaped and code/HTML text literal: %j", source => {
  expect(mathNodes(source)).toHaveLength(0);
});

it.each([
  "$$\nx^2\n+y^2\n$$",
  "$$\nx\n\ny\n$$",
  "$$$\nx\n$$\ny\n$$$",
  "> $$\n> x\n> $$",
  "- $$\n  x\n  $$",
])("recognizes multiline display math and its exact closing fence in composite blocks: %j", source => {
  const nodes = mathNodes(source + "\n\nAfter $z$");
  expect(nodes).toHaveLength(2); expect(nodes[0]!.kind).toBe("SlateMathBlock");
  expect(nodes[0]!.marks).toEqual(source.includes("$$$") ? ["$$$", "$$$"] : ["$$", "$$"]);
  expect(nodes[0]!.to).toBe(source.length); expect(nodes[1]!.source).toBe("$z$");
});

it("ends an unfinished quoted math block when its containing quote ends", () => {
  const source = "> $$\n> x\n\nOutside $z$", nodes = mathNodes(source);
  expect(nodes).toHaveLength(2); expect(nodes[0]!.kind).toBe("SlateMathBlock");
  expect(nodes[0]!.marks).toEqual(["$$"]); expect(nodes[0]!.to).toBe(8);
  expect(nodes[1]!.source).toBe("$z$");
});

it("does not parse a math body's TeX underscore, brackets or backticks as inline Markdown", () => {
  const source = "$x_i + [text] + `code`$", state = EditorState.create({ doc: source, extensions: [markdown({ extensions: slateMarkdownSyntax })] });
  expect(mathNodes(source)).toHaveLength(1);
  expect(syntaxTree(state).toString()).not.toMatch(/Emphasis|InlineCode|Link/);
});

it("preserves blank lines in the renderable math body without including quote prefixes", () => {
  const source = "> $$\n> x\n>\n> y\n> $$";
  expect(mathNodes(source)[0]!.body).toBe("x\n\ny");
});

it("does not let a math-like YAML scalar consume Markdown after front matter", () => {
  const source = "---\nexample: |\n  $$\n---\n\n# Actual heading\n\nInline $z$";
  const state = EditorState.create({ doc: source, extensions: [markdown({ extensions: slateMarkdownSyntax })] });
  expect(mathNodes(source).map(node => node.source)).toEqual(["$z$"]);
  expect(syntaxTree(state).toString()).toContain("ATXHeading1");
});

it("keeps multiple prices literal while still recognizing a later formula", () => {
  expect(mathNodes("Costs $20 and $30; solve $x+y$.").map(node => node.source)).toEqual(["$x+y$"]);
});
