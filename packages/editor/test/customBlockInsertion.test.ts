import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readCustomBlock } from "@slate/core";
import { createSlateMarkdownExtensions } from "../src/index";
import { editorBlockTarget } from "../src/editorBlocks";
import {
  requestEditorCustomBlock,
  insertEditorCustomBlock,
} from "../src/customBlockInsertion";

const block = readCustomBlock(
  "\uFEFF> বাংলা 🙂 {{date}} ${1:Text}$0\r\n",
  ".slate/blocks/Quote.md",
);
const views: EditorView[] = [];
beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
});
afterEach(() => {
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
  vi.restoreAllMocks();
});
function editor(source: string) {
  const editable = new Compartment();
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({
      doc: source,
      selection: { anchor: source.length },
      extensions: [
        createSlateMarkdownExtensions(),
        EditorState.allowMultipleSelections.of(true),
        editable.of([
          EditorState.readOnly.of(false),
          EditorView.editable.of(true),
        ]),
      ],
    }),
  });
  views.push(view);
  return { view, editable };
}

it("captures a slash request and inserts literal source as one undoable transaction", () => {
  const source = "Before /quote",
    { view } = editor(source),
    request = requestEditorCustomBlock(view.state)!;
  expect(request).toMatchObject({
    from: 7,
    to: 13,
    source: view.state.doc,
    selection: view.state.selection,
  });
  expect(insertEditorCustomBlock(view, request, block).kind).toBe("insert");
  expect(view.state.doc.toString()).toBe(
    "Before \n\n> বাংলা 🙂 {{date}} ${1:Text}$0\n",
  );
  expect(view.state.selection.main.head).toBe(view.state.doc.length);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(source);
  expect(redo(view)).toBe(true);
  expect(view.state.doc.toString()).toContain("${1:Text}$0");
});

it("keeps later IME edits separate from the expansion while grouping their composition updates", () => {
  const { view } = editor("/quote"),
    request = requestEditorCustomBlock(view.state)!;
  insertEditorCustomBlock(
    view,
    request,
    readCustomBlock("> Text", ".slate/blocks/Quote.md"),
  );
  const from = view.state.selection.main.head;
  view.dispatch({
    changes: { from, insert: "ন" },
    userEvent: "input.type.compose",
  });
  view.dispatch({
    changes: { from, to: from + 1, insert: "নোট" },
    userEvent: "input.type.compose",
  });
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("> Text");
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("/quote");
});

it.each([
  "```md\n/quote",
  "`/quote`",
  "    /quote",
  "[link](/quote)",
  "https://example.test/quote",
  "---\ntitle: /quote\n---",
  "| A | B |\n| --- | --- |\n| /quote | B |",
])("does not capture a protected slash: %j", (source) => {
  const { view } = editor(source);
  const position = source.indexOf("/quote") + 6;
  view.dispatch({ selection: { anchor: position } });
  expect(requestEditorCustomBlock(view.state)).toBeUndefined();
});

it("rejects selected and multiple-caret slash requests", () => {
  const { view } = editor("/quote /quote");
  view.dispatch({ selection: { anchor: 7, head: 13 } });
  expect(requestEditorCustomBlock(view.state)).toBeUndefined();
  view.dispatch({
    selection: EditorSelection.create([
      EditorSelection.cursor(6),
      EditorSelection.cursor(13),
    ]),
  });
  expect(requestEditorCustomBlock(view.state)).toBeUndefined();
});

it.each([
  "source",
  "selection",
  "readonly",
  "disabled",
  "composing",
  "disconnected",
])("rejects an async request after %s changes", (kind) => {
  const { view, editable } = editor("/quote"),
    request = requestEditorCustomBlock(view.state)!;
  if (kind === "source")
    view.dispatch({ changes: { from: 6, insert: " newer" } });
  if (kind === "selection") view.dispatch({ selection: { anchor: 0 } });
  if (kind === "readonly")
    view.dispatch({
      effects: editable.reconfigure(EditorState.readOnly.of(true)),
    });
  if (kind === "disabled")
    view.dispatch({
      effects: editable.reconfigure(EditorView.editable.of(false)),
    });
  if (kind === "composing")
    vi.spyOn(view, "compositionStarted", "get").mockReturnValue(true);
  if (kind === "disconnected") view.dom.parentElement?.remove();
  const before = view.state.doc.toString();
  expect(insertEditorCustomBlock(view, request, block).kind).toBe(
    "unavailable",
  );
  expect(view.state.doc.toString()).toBe(before);
});

it("captures a gutter boundary after an entire fenced block without editing its code", () => {
  const source = "```md\nLiteral\n```\n\nNext",
    { view } = editor(source),
    target = editorBlockTarget(view.state, source.indexOf("Literal"))!,
    request = requestEditorCustomBlock(view.state, target)!;
  expect(request.from).toBe(target.position);
  expect(request.to).toBe(target.position);
  expect(
    insertEditorCustomBlock(
      view,
      request,
      readCustomBlock("> Quote", ".slate/blocks/Quote.md"),
    ).kind,
  ).toBe("insert");
  expect(view.state.doc.toString()).toBe(
    "```md\nLiteral\n```\n\n> Quote\n\nNext",
  );
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(source);
});

it("rejects stale gutter targets and cannot capture while read-only or disabled", () => {
  const { view, editable } = editor("First\n\nLast"),
    target = editorBlockTarget(view.state, 1)!;
  view.dispatch({ changes: { from: view.state.doc.length, insert: " newer" } });
  expect(requestEditorCustomBlock(view.state, target)).toBeUndefined();
  const current = editorBlockTarget(view.state, 1)!;
  view.dispatch({
    effects: editable.reconfigure(EditorState.readOnly.of(true)),
  });
  expect(requestEditorCustomBlock(view.state, current)).toBeUndefined();
  view.dispatch({
    effects: editable.reconfigure(EditorView.editable.of(false)),
  });
  expect(requestEditorCustomBlock(view.state, current)).toBeUndefined();
});

it("preserves a note BOM and its original slash through insertion and undo", () => {
  const original = "\uFEFF/quote",
    { view } = editor(original),
    request = requestEditorCustomBlock(view.state)!;
  expect(request.from).toBe(1);
  expect(
    insertEditorCustomBlock(
      view,
      request,
      readCustomBlock("> Quote", ".slate/blocks/Quote.md"),
    ).kind,
  ).toBe("insert");
  expect(view.state.doc.toString()).toBe("\uFEFF> Quote");
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(original);
});

it("places a prepared template cursor and keeps the insertion one undo step", () => {
  const { view } = editor("/template"),
    request = requestEditorCustomBlock(view.state)!;
  expect(
    insertEditorCustomBlock(view, request, {
      source: "\uFEFFHello\r\nthere",
      cursor: 8,
    }).kind,
  ).toBe("insert");
  expect(view.state.doc.toString()).toBe("Hello\nthere");
  expect(view.state.selection.main.head).toBe(6);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("/template");
  expect(redo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("Hello\nthere");
});
