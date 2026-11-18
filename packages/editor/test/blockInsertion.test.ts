import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { afterEach, expect, it, vi } from "vitest";
import { builtinBlocks } from "@slate/core";
import {
  createSlateMarkdownExtensions,
  editorBlockQuery,
  insertEditorBlock,
} from "../src/index";

const views: EditorView[] = [];
function editor(source: string, head = source.length, readOnly = false) {
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({
      doc: source,
      selection: { anchor: head },
      extensions: [
        createSlateMarkdownExtensions(),
        EditorState.readOnly.of(readOnly),
      ],
    }),
  });
  views.push(view);
  return view;
}
afterEach(() => {
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
});

it.each(["/", "/ta", "words /table", "words\t/toc", "# Heading /quote"])(
  "recognizes an eligible query in %s",
  (source) => {
    const query = editorBlockQuery(editor(source).state)!;
    expect(source.slice(query.from, query.to)).toBe(`/${query.query}`);
    expect(query.to).toBe(source.length);
  },
);

it.each([
  "https://example.com/table",
  "words/table",
  "\\/table",
  "` /table`",
  "```md\n/table\n```",
  "    /table",
  "\t/table",
  "[label]( /table)",
  "<div>\n/table\n</div>",
  "<!-- /table -->",
  "<!--\n/table\n-->",
  "---\ntitle: /table\n---",
])("keeps literal slashes in %s", (source) => {
  const head = source.indexOf("/table") + "/table".length;
  expect(editorBlockQuery(editor(source, head).state)).toBeUndefined();
});

it("does not treat a later horizontal rule as front-matter", () => {
  const view = editor("# Heading\n\n---\n\n/table");
  expect(editorBlockQuery(view.state)?.query).toBe("table");
  const yaml = editor("---\ntitle: My sheet\n---\n\n/table");
  expect(editorBlockQuery(yaml.state)?.query).toBe("table");
});

it("checks ordinary typing in a long paragraph without materializing the full line", () => {
  const state = EditorState.create({
    doc: "words ".repeat(50_000) + "ordinary",
    selection: { anchor: 300_008 },
    extensions: createSlateMarkdownExtensions(),
  });
  const line = vi.spyOn(state.doc, "lineAt").mockImplementation(() => {
    throw new Error("Full line access on ordinary input");
  });
  try {
    expect(editorBlockQuery(state)).toBeUndefined();
  } finally {
    line.mockRestore();
  }
});

it("preserves the real slash boundary when a query fills the lookback window", () => {
  const query = "t".repeat(64);
  const valid = "long ".repeat(30) + "/" + query;
  expect(editorBlockQuery(editor(valid).state)?.query).toBe(query);
  const invalid = "a".repeat(100) + "/" + query;
  expect(editorBlockQuery(editor(invalid).state)).toBeUndefined();
});

it.each(builtinBlocks.map(({ id }) => id))(
  "inserts %s in one undo step and leaves the preceding edit intact",
  (id) => {
    const view = editor("/");
    view.dispatch({ changes: { from: 1, insert: "query" } });
    const source = view.state.doc.toString();
    const plan = insertEditorBlock(view, id, {
      from: 0,
      to: source.length,
      language: "typescript",
      image: { path: "assets/a.png" },
      date: "2026-11-18",
      time: "12:30:00",
    });
    expect(plan.kind).toBe("insert");
    if (plan.kind !== "insert") throw new Error("Expected insertion");
    const inserted = view.state.doc.toString();
    expect(view.state.selection.main.anchor).toBe(plan.selection.anchor);
    expect(view.state.selection.main.head).toBe(plan.selection.head);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(inserted);
    expect(undo(view)).toBe(true);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("/");
  },
);

it("does not edit while a picker is pending and rejects a changed document", () => {
  const view = editor("/image");
  const context = { from: 0, to: 6 };
  expect(insertEditorBlock(view, "image", context)).toEqual({
    kind: "request",
    input: "image",
  });
  expect(view.state.doc.toString()).toBe("/image");
  view.dispatch({ changes: { from: 6, insert: " new words" } });
  expect(
    insertEditorBlock(
      view,
      "image",
      { ...context, image: { path: "assets/a.png" } },
      "/image",
    ).kind,
  ).toBe("unavailable");
  expect(view.state.doc.toString()).toBe("/image new words");
});

it("keeps read-only sheets and nonempty selections out of slash completion", () => {
  const view = editor("/table", 6, true);
  expect(editorBlockQuery(view.state)).toBeUndefined();
  expect(insertEditorBlock(view, "table", { from: 0, to: 6 }).kind).toBe(
    "unavailable",
  );
  const selected = editor("/table");
  selected.dispatch({ selection: { anchor: 0, head: 6 } });
  expect(editorBlockQuery(selected.state)).toBeUndefined();
});

it("keeps block-level slash insertion out of table cells", () => {
  const source = "| Name | Content |\n|---|---|\n| A | /table |";
  expect(editorBlockQuery(editor(source, source.indexOf("/table") + 6).state)).toBeUndefined();
});
