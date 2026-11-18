import { EditorSelection, EditorState } from "@codemirror/state";
import { expect, it, vi } from "vitest";
import { createSlateMarkdownExtensions } from "../src/index";
import { markdownCompletionQuery } from "../src/completionQuery";

function state(text: string) {
  const position = text.indexOf("¦");
  return EditorState.create({
    doc: text.replace("¦", ""),
    selection: { anchor: position },
    extensions: createSlateMarkdownExtensions(),
  });
}

it.each([
  ["[[¦", "wiki", ""],
  ["See [[New idea¦", "wiki", "New idea"],
  ["See [[Ta¦]]", "wiki", "Ta"],
  ["বাংলা [[নোট¦", "wiki", "নোট"],
  ["#¦", "tag", ""],
  ["Text #work/pro¦", "tag", "work/pro"],
  ["> #work¦", "tag", "work"],
  ["(#work¦)", "tag", "work"],
  ["@¦", "date", ""],
  ["Meet @today¦", "date", "today"],
  ["Meet @2026-11-18¦", "date", "2026-11-18"],
  ["---\ntitle: Note\n---\n[[Ta¦", "wiki", "Ta"],
])("detects a bounded %s query", (text, kind, query) => {
  const editor = state(text);
  const result = markdownCompletionQuery(editor)!;
  expect(result.kind).toBe(kind);
  expect(result.query).toBe(query);
  expect(editor.sliceDoc(result.contentFrom, result.to)).toBe(query);
  expect(editor.sliceDoc(result.from, result.contentFrom)).toBe(
    kind === "wiki" ? "[[" : kind === "tag" ? "#" : "@",
  );
});

it.each([
  "plain text¦",
  "a@today¦",
  "https://site/#tag¦",
  "https://site/@today¦",
  "# heading¦",
  "#_bad¦",
  "[[[Ta¦",
  "[[Ta|alias¦",
  "[[closed]]¦",
  "```\n[[Ta¦\n```",
  "`[[Ta¦]]`",
  "[label #tag¦](https://site/)",
  "<!-- #tag¦ -->",
  "<a title='@today¦'>link</a>",
  "---\ntitle: [[Ta¦\n---",
  "\uFEFF---\ntags: #ta¦\n...",
  "[[" + "a".repeat(129) + "¦",
  "#" + "a".repeat(129) + "¦",
])("does not automate literal source: %s", (text) => {
  expect(markdownCompletionQuery(state(text))).toBeUndefined();
});

it("refuses readonly or nonempty/multiple selections", () => {
  const editor = state("[[Ta¦");
  expect(
    markdownCompletionQuery(
      editor.update({ selection: { anchor: 0, head: 4 } }).state,
    ),
  ).toBeUndefined();
  expect(
    markdownCompletionQuery(
      EditorState.create({
        doc: "[[Ta",
        selection: { anchor: 4 },
        extensions: [
          createSlateMarkdownExtensions(),
          EditorState.readOnly.of(true),
        ],
      }),
    ),
  ).toBeUndefined();
  const multiple = EditorState.create({
    doc: "[[Ta\n#ta",
    selection: EditorSelection.create([
      EditorSelection.cursor(4),
      EditorSelection.cursor(8),
    ]),
    extensions: [
      createSlateMarkdownExtensions(),
      EditorState.allowMultipleSelections.of(true),
    ],
  });
  expect(markdownCompletionQuery(multiple)).toBeUndefined();
});

it("does not materialize the caret line while checking ordinary typing in a long paragraph", () => {
  const editor = state("words ".repeat(50_000) + "ordinary¦");
  const line = vi.spyOn(editor.doc, "lineAt").mockImplementation(() => {
    throw new Error("Full line access on ordinary input");
  });
  try {
    expect(markdownCompletionQuery(editor)).toBeUndefined();
  } finally {
    line.mockRestore();
  }
});
