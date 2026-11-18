import { history, redo, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { indentUnit } from "@codemirror/language";
import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { parseSnippetTemplate, renderSnippetTemplate } from "@slate/core";
import { afterEach, expect, it, vi } from "vitest";
import {
  clearEditorSnippet,
  editorSnippetFields,
  insertEditorSnippet,
  moveEditorSnippetField,
  requestEditorSnippet,
} from "../src/snippetInsertion";
import { historyIsolation } from "../src/historyIsolation";

const views: EditorView[] = [];
function editor(doc = ";x", from = doc.length, to = from) {
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({
      doc,
      selection: { anchor: from, head: to },
      extensions: [
        history(),
        historyIsolation,
        markdown(),
        indentUnit.of("  "),
      ],
    }),
  });
  views.push(view);
  return view;
}
function expand(view: EditorView, source: string, from = 0) {
  const request = requestEditorSnippet(view.state, from)!;
  expect(request).toBeDefined();
  expect(
    insertEditorSnippet(
      view,
      request,
      renderSnippetTemplate(parseSnippetTemplate(source), {}),
    ),
  ).toBe(true);
}
function selected(view: EditorView) {
  return view.state.selection.ranges.map((range) =>
    view.state.sliceDoc(range.from, range.to),
  );
}
function type(view: EditorView, text: string) {
  view.dispatch({
    ...view.state.replaceSelection(text),
    userEvent: "input.type",
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
});

it("inserts at a trigger, selects ordered fields and restores the trigger with one undo", () => {
  const view = editor("Words ;x");
  expand(view, "${2:second} ${1:first}$0", 6);
  expect(view.state.doc.toString()).toBe("Words second first");
  expect(selected(view)).toEqual(["first"]);
  expect(moveEditorSnippetField(view, -1)).toBe(false);
  expect(moveEditorSnippetField(view, 1)).toBe(true);
  expect(selected(view)).toEqual(["second"]);
  expect(moveEditorSnippetField(view, -1)).toBe(true);
  expect(selected(view)).toEqual(["first"]);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("Words ;x");
  expect(view.state.selection.main.head).toBe(8);
  expect(moveEditorSnippetField(view, 1)).toBe(false);
  expect(undo(view)).toBe(false);
  expect(redo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("Words second first");
  expect(moveEditorSnippetField(view, 1)).toBe(false);
});
it("keeps later fields after replacing an outer nested placeholder, skipping its removed descendants", () => {
  const view = editor();
  expand(view, "${1:hello ${2:world}} then ${3:bye}$0");
  expect(selected(view)).toEqual(["hello world"]);
  type(view, "Alice");
  expect(view.state.doc.toString()).toBe("Alice then bye");
  expect(moveEditorSnippetField(view, 1)).toBe(true);
  expect(selected(view)).toEqual(["bye"]);
  type(view, "Bob");
  expect(moveEditorSnippetField(view, 1)).toBe(true);
  expect(view.state.selection.main.head).toBe(view.state.doc.length);
  expect(moveEditorSnippetField(view, 1)).toBe(false);
  expect(view.state.doc.toString()).toBe("Alice then Bob");
});

it("keeps IME edits in different fields separate from one another and the expansion", () => {
  const view = editor();
  expand(view, "${1:hello ${2:world}} then ${3:bye}$0");
  view.dispatch({
    ...view.state.replaceSelection("Alice"),
    userEvent: "input.type.compose",
  });
  expect(moveEditorSnippetField(view, 1)).toBe(true);
  view.dispatch({
    ...view.state.replaceSelection("Bob"),
    userEvent: "input.type.compose",
  });
  expect(moveEditorSnippetField(view, 1)).toBe(true);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("Alice then bye");
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("hello world then bye");
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(";x");
});
it("visits unchanged nested fields and preserves outer ranges after editing a child", () => {
  const view = editor();
  expand(view, "${1:hello ${2:world}} then ${3:bye}$0");
  expect(moveEditorSnippetField(view, 1)).toBe(true);
  expect(selected(view)).toEqual(["world"]);
  type(view, "🙂 friend");
  expect(moveEditorSnippetField(view, -1)).toBe(true);
  expect(selected(view)).toEqual(["hello 🙂 friend"]);
  expect(moveEditorSnippetField(view, 1)).toBe(true);
  expect(moveEditorSnippetField(view, 1)).toBe(true);
  expect(selected(view)).toEqual(["bye"]);
});
it("selects linked occurrences and maps later fields after a multi-selection replacement", () => {
  const view = editor();
  expand(view, "$1 / ${1:Name} / ${2:Role}$0");
  expect(selected(view)).toEqual(["Name", "Name"]);
  type(view, "Ada");
  expect(view.state.doc.toString()).toBe("Ada / Ada / Role");
  expect(moveEditorSnippetField(view, 1)).toBe(true);
  expect(selected(view)).toEqual(["Role"]);
  expect(moveEditorSnippetField(view, -1)).toBe(true);
  expect(selected(view)).toEqual(["Ada", "Ada"]);
});
it("keeps literal JSON, variable-supplied field syntax, dollars and backslashes exact", () => {
  const view = editor();
  const result = renderSnippetTemplate(
    parseSnippetTemplate('${1:{"value": 1}} {{clipboard}} ${2:next}$0'),
    {
      clipboard: String.raw`\${9:literal} #{not a field} {{date}}`,
    },
  );
  expect(
    insertEditorSnippet(view, requestEditorSnippet(view.state, 0)!, result),
  ).toBe(true);
  expect(view.state.doc.toString()).toBe(
    '{"value": 1} ' +
      String.raw`\${9:literal} #{not a field} {{date}}` +
      " next",
  );
  expect(selected(view)).toEqual(['{"value": 1}']);
  expect(moveEditorSnippetField(view, 1)).toBe(true);
  expect(selected(view)).toEqual(["next"]);
});
it("maps multiline UTF-16 fields through CodeMirror indentation without changing their text", () => {
  const view = editor("  ;x");
  expand(view, "🙂\n\t${1:Name}\n\t${2:first\n\tsecond}\n$0", 2);
  expect(view.state.doc.toString()).toBe(
    "  🙂\n    Name\n    first\n    second\n  ",
  );
  expect(selected(view)).toEqual(["Name"]);
  type(view, "A");
  expect(moveEditorSnippetField(view, 1)).toBe(true);
  expect(selected(view)).toEqual(["first\n    second"]);
  expect(moveEditorSnippetField(view, 1)).toBe(true);
  expect(view.state.selection.main.head).toBe(view.state.doc.length);
});
it("handles adjacent empty stops, nested empty stops and explicit non-end final cursors", () => {
  const view = editor();
  expand(view, "$1${2:two}$0 end");
  type(view, "one");
  expect(moveEditorSnippetField(view, 1)).toBe(true);
  expect(selected(view)).toEqual(["two"]);
  expect(moveEditorSnippetField(view, 1)).toBe(true);
  expect(view.state.selection.main.head).toBe(6);
  const nested = editor();
  expand(nested, "${1:$2}${3:three}$0");
  type(nested, "one");
  expect(moveEditorSnippetField(nested, 1)).toBe(true);
  expect(selected(nested)).toEqual(["three"]);
});
it("an implicit final cursor needs no active session, and plain selected text undoes exactly", () => {
  const view = editor("Keep words", 5, 10);
  expand(view, "literal text", 5);
  expect(view.state.doc.toString()).toBe("Keep literal text");
  expect(view.state.selection.main.head).toBe(17);
  expect(clearEditorSnippet(view)).toBe(false);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("Keep words");
  expect(selected(view)).toEqual(["words"]);
});
it("clears fields on Escape, selection outside, readonly reconfiguration or undoing a placeholder edit", () => {
  const view = editor();
  expand(view, "${1:first} ${2:second}$0");
  expect(clearEditorSnippet(view)).toBe(true);
  expect(clearEditorSnippet(view)).toBe(false);
  expand(view, "${1:first} ${2:second}$0");
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  expect(moveEditorSnippetField(view, 1)).toBe(false);
  expand(view, "${1:first} ${2:second}$0");
  view.dispatch({
    effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)),
  });
  expect(moveEditorSnippetField(view, 1)).toBe(false);
  const edited = editor();
  expand(edited, "${1:first} ${2:second}$0");
  type(edited, "New");
  expect(undo(edited)).toBe(true);
  expect(edited.state.doc.toString()).toBe("first second");
  expect(moveEditorSnippetField(edited, 1)).toBe(false);
});
it("rejects changed source/selection, detached editors, disabled editing and read-only state", () => {
  for (const mutation of [
    (view: EditorView) => view.dispatch({ selection: { anchor: 0 } }),
    (view: EditorView) => view.dispatch({ changes: { from: 0, insert: "x" } }),
    (view: EditorView) => view.dom.remove(),
    (view: EditorView) =>
      view.dispatch({
        effects: StateEffect.appendConfig.of(EditorView.editable.of(false)),
      }),
    (view: EditorView) =>
      view.dispatch({
        effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)),
      }),
  ]) {
    const view = editor(),
      request = requestEditorSnippet(view.state, 0)!;
    mutation(view);
    const original = view.state.doc;
    expect(
      insertEditorSnippet(
        view,
        request,
        renderSnippetTemplate(parseSnippetTemplate("text"), {}),
      ),
    ).toBe(false);
    expect(view.state.doc).toBe(original);
  }
});
it.each(["`;x`", "```md\n;x", "    ;x", "---\n;x", "[link](;x)", "<!-- ;x"])(
  "never starts inside protected Markdown input %j",
  (source) => {
    const view = editor(source, source.indexOf(";x") + 2);
    expect(
      requestEditorSnippet(view.state, Math.max(0, source.indexOf(";x"))),
    ).toBeUndefined();
  },
);
it("rejects multiple selections and invalid replacement ranges", () => {
  const view = editor("one two");
  expect(requestEditorSnippet(view.state, -1)).toBeUndefined();
  expect(requestEditorSnippet(view.state, 8)).toBeUndefined();
  view.dispatch({
    effects: StateEffect.appendConfig.of(editorSnippetFields()),
  });
  view.dispatch({
    selection: EditorSelection.create([
      EditorSelection.cursor(0),
      EditorSelection.cursor(5),
    ]),
  });
  expect(requestEditorSnippet(view.state)).toBeUndefined();
});

it("leaves an IME composition intact and refuses to navigate its fields", () => {
  const view = editor(),
    request = requestEditorSnippet(view.state, 0)!;
  const composing = vi
    .spyOn(view, "compositionStarted", "get")
    .mockReturnValue(true);
  expect(
    insertEditorSnippet(
      view,
      request,
      renderSnippetTemplate(parseSnippetTemplate("${1:a}$0"), {}),
    ),
  ).toBe(false);
  expect(view.state.doc.toString()).toBe(";x");
  composing.mockReturnValue(false);
  expand(view, "${1:a} ${2:b}$0");
  composing.mockReturnValue(true);
  expect(moveEditorSnippetField(view, 1)).toBe(false);
  expect(selected(view)).toEqual(["a"]);
});

it("keeps field navigation above ordinary Tab bindings and releases it after the final stop", () => {
  const view = editor();
  expand(view, "${1:first} ${2:second}$0");
  const tab = () => {
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      keyCode: 9,
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(tab()).toBe(true);
  expect(selected(view)).toEqual(["second"]);
  expect(tab()).toBe(true);
  expect(view.state.selection.main.head).toBe(view.state.doc.length);
  expect(tab()).toBe(false);
});
