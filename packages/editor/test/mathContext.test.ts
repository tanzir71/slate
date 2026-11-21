import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { expect, it } from "vitest";
import { markdownInputAllowed } from "../src/markdownInputContext";
import { slateMarkdownSyntax } from "../src/markdownSyntax";

it.each(["$x_i$", "$$\nx_i\n$$", "> $$\n> x_i\n> $$"])("keeps automatic Markdown input out of TeX: %j", source => {
  const position = source.indexOf("x_i") + 1;
  const state = EditorState.create({ doc: source, selection: { anchor: position }, extensions: [markdown({ extensions: slateMarkdownSyntax })] });
  expect(markdownInputAllowed(state, position)).toBe(false);
  expect(state.doc.toString()).toBe(source);
});

it.each(["Price $20", "$$\nx_i\n$$\n\nOrdinary x_i", "---\nx: $$\n---\n\nOrdinary x_i"])("retains ordinary Markdown input outside math and metadata: %j", source => {
  const position = source.length;
  const state = EditorState.create({ doc: source, selection: { anchor: position }, extensions: [markdown({ extensions: slateMarkdownSyntax })] });
  expect(markdownInputAllowed(state, position)).toBe(true);
});
