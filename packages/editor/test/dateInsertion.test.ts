import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo, redo } from "@codemirror/commands";
import { afterEach, expect, it } from "vitest";
import { createSlateMarkdownExtensions } from "../src/index";
import { requestEditorDate, insertEditorDate } from "../src/dateInsertion";

const views: EditorView[] = [];
function editor(doc: string, readOnly = false) {
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
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

it.each(["@", "@date", "Words @2026-11-18"])(
  "replaces %s with a chosen date in one undo and restores the caret",
  (source) => {
    const view = editor(source);
    const request = requestEditorDate(view.state)!;
    expect(insertEditorDate(view, request, "2024-02-29")).toBe(true);
    const expected = source.slice(0, source.indexOf("@")) + "2024-02-29";
    expect(view.state.doc.toString()).toBe(expected);
    expect(view.state.selection.main.head).toBe(expected.length);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    expect(view.state.selection.main.head).toBe(source.length);
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(expected);
  },
);

it("isolates the date choice from preceding typing", () => {
  const view = editor("Words ");
  view.dispatch({
    changes: { from: 6, insert: "@date" },
    selection: { anchor: 11 },
    annotations: Transaction.userEvent.of("input.type"),
  });
  expect(
    insertEditorDate(view, requestEditorDate(view.state)!, "2026-11-18"),
  ).toBe(true);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("Words @date");
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("Words ");
});

it("leaves literal input and no undo entry when the picker is cancelled", () => {
  const view = editor("Words @date");
  expect(requestEditorDate(view.state)?.query.query).toBe("date");
  expect(view.state.doc.toString()).toBe("Words @date");
  expect(undo(view)).toBe(false);
});

it("rejects changed source, changed selection, read-only and invalid dates without editing", () => {
  const view = editor("Words @date");
  const request = requestEditorDate(view.state)!;
  expect(insertEditorDate(view, request, "2026-02-29")).toBe(false);
  view.dispatch({ selection: { anchor: 0 } });
  expect(insertEditorDate(view, request, "2026-11-18")).toBe(false);
  view.dispatch({
    changes: { from: 0, insert: "Changed " },
    selection: { anchor: 19 },
  });
  expect(insertEditorDate(view, request, "2026-11-18")).toBe(false);
  expect(view.state.doc.toString()).toBe("Changed Words @date");
  const readonly = editor("@date", true);
  expect(requestEditorDate(readonly.state)).toBeUndefined();
  expect(insertEditorDate(readonly, request, "2026-11-18")).toBe(false);
});

it.each(["words", "name@example", "`@date`", "---\n@date", "```md\n@date"])(
  "never starts a picker from excluded input: %s",
  (source) => {
    expect(requestEditorDate(editor(source).state)).toBeUndefined();
  },
);
