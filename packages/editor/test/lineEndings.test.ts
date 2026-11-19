import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { expect, it } from "vitest";
import { editorSource, editorSourceEffect, tidyEditorHistory } from "../src/tidy";

function editor(source: string) {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({ parent, state: EditorState.create({
    doc: source.replace(/\r\n?/g, "\n"), extensions: [history(), tidyEditorHistory(source)],
  }) });
  return { view, close() { view.destroy(); parent.remove(); } };
}

it.each(["\n", "\r\n", "\r"])("keeps %j endings and BOM through typing, line insertion, Undo and Redo", (eol) => {
  const original = `\uFEFFFirst${eol}Last${eol}`;
  const { view, close } = editor(original);
  try {
    view.dispatch({ changes: { from: 1, insert: "New " }, annotations: Transaction.userEvent.of("input.type") });
    expect(editorSource(view.state)).toBe(`\uFEFFNew First${eol}Last${eol}`);
    view.dispatch({ changes: { from: 5, insert: "one\ntwo\n" }, annotations: Transaction.userEvent.of("input.type") });
    const expected = `\uFEFFNew one${eol}two${eol}First${eol}Last${eol}`;
    expect(editorSource(view.state)).toBe(expected);
    expect(undoDepth(view.state)).toBe(1);
    expect(undo(view)).toBe(true); expect(editorSource(view.state)).toBe(original);
    expect(redo(view)).toBe(true); expect(editorSource(view.state)).toBe(expected);
  } finally { close(); }
});

it("keeps untouched mixed endings when one transaction edits several separate lines", () => {
  const original = "a\r\nb\rc\nd\r\ne\r";
  const { view, close } = editor(original);
  try {
    view.dispatch({ changes: [{ from: 1, to: 2, insert: "\nnew\n" }, { from: 5, to: 6, insert: "!" }, { from: 8, insert: "tail\n" }] });
    const expected = "a\r\nnew\r\nb\rc!d\r\ntail\r\ne\r";
    expect(editorSource(view.state)).toBe(expected);
    expect(undo(view)).toBe(true); expect(editorSource(view.state)).toBe(original);
    expect(redo(view)).toBe(true); expect(editorSource(view.state)).toBe(expected);
  } finally { close(); }
});

it("restores the earliest ending metadata when adjacent newline edits share an Undo event", () => {
  const original = "a\r\nb\rc\n";
  const { view, close } = editor(original);
  try {
    view.dispatch({ changes: { from: 1, to: 2, insert: "" }, annotations: Transaction.userEvent.of("input.type") });
    view.dispatch({ changes: { from: 1, to: 3, insert: "\nX\n" }, annotations: Transaction.userEvent.of("input.type") });
    const expected = "a\r\nX\r\nc\n";
    expect(editorSource(view.state)).toBe(expected); expect(undoDepth(view.state)).toBe(1);
    expect(undo(view)).toBe(true); expect(editorSource(view.state)).toBe(original);
    expect(redo(view)).toBe(true); expect(editorSource(view.state)).toBe(expected);
  } finally { close(); }
});

it("retains the original ending preference after deleting every newline", () => {
  const { view, close } = editor("a\rb\r");
  try {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "word" } });
    expect(editorSource(view.state)).toBe("word");
    view.dispatch({ changes: { from: 4, insert: "\nnext" } });
    expect(editorSource(view.state)).toBe("word\rnext");
  } finally { close(); }
});

it("changes ending style only through an explicit source replacement and restores it through Undo", () => {
  const { view, close } = editor("a\r\nb\r\n");
  try {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "x\ny\n" }, effects: editorSourceEffect("x\ry\r") });
    expect(editorSource(view.state)).toBe("x\ry\r");
    expect(undo(view)).toBe(true); expect(editorSource(view.state)).toBe("a\r\nb\r\n");
    expect(redo(view)).toBe(true); expect(editorSource(view.state)).toBe("x\ry\r");
    view.dispatch({ changes: { from: 0, to: 1, insert: "z" }, effects: editorSourceEffect("z\ny\n") });
    expect(editorSource(view.state)).toBe("z\ny\n");
  } finally { close(); }
});
