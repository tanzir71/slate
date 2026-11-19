import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  createSnippetIndex,
  readSnippetConfiguration,
  resolveSnippets,
  renderSnippetTemplate,
  parseSnippetTemplate,
} from "@slate/core";
import { afterEach, expect, it, vi } from "vitest";
import { createSnippetTriggers } from "../src/snippetTriggers";
import {
  editorSnippetFields,
  insertEditorSnippet,
} from "../src/snippetInsertion";
import { createSmartTableBindings } from "../src/smartTables";
import { createMarkdownCompletions } from "../src/markdownCompletions";
import { completionStatus } from "@codemirror/autocomplete";

const views: EditorView[] = [];
const index = createSnippetIndex(
  resolveSnippets(
    readSnippetConfiguration({
      version: 1,
      snippets: [
        { trigger: ";x", body: "${1:Name} ${2:Role}$0", expandOn: "both" },
        { trigger: "s".repeat(64), body: "long" },
      ],
    }),
    readSnippetConfiguration({ version: 1, snippets: [] }),
  ),
);
function editor(doc: string, position = doc.length) {
  const onExpand = vi.fn(
    (
      view: EditorView,
      request: import("../src/snippetInsertion").EditorSnippetRequest,
      definition: import("@slate/core").ScopedSnippet,
    ) =>
      insertEditorSnippet(
        view,
        request,
        renderSnippetTemplate(parseSnippetTemplate(definition.body), {}),
      ),
  );
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({
      doc,
      selection: { anchor: position },
      extensions: [
        history(),
        markdown(),
        createMarkdownCompletions(),
        editorSnippetFields(),
        createSnippetTriggers({ index, onExpand }),
        createSmartTableBindings(),
      ],
    }),
  });
  views.push(view);
  return { view, onExpand };
}
const press = (view: EditorView, key: string) => {
  const event = new KeyboardEvent("keydown", {
    key,
    code: key === " " ? "Space" : key,
    keyCode: key === "Tab" ? 9 : 32,
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
});

it.each(["Tab", " "])(
  "expands a trigger with %j and one undo restores its exact source",
  (key) => {
    const { view, onExpand } = editor("Words ;x");
    expect(press(view, key)).toBe(true);
    expect(onExpand).toHaveBeenCalledOnce();
    expect(view.state.doc.toString()).toBe("Words Name Role");
    expect(
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ),
    ).toBe("Name");
    expect(press(view, "Tab")).toBe(true);
    expect(
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ),
    ).toBe("Role");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("Words ;x");
  },
);
it("handles native Space input without a preceding keydown, and ignores ordinary or multi-character input", () => {
  const { view, onExpand } = editor(";x");
  const input = (text: string) =>
    view.state
      .facet(EditorView.inputHandler)
      .some((handler) =>
        handler(view, 2, 2, text, () =>
          view.state.update({ changes: { from: 2, insert: text } }),
        ),
      );
  expect(input("  ")).toBe(false);
  expect(input("word")).toBe(false);
  expect(input(" ")).toBe(true);
  expect(view.state.doc.toString()).toBe("Name Role");
  expect(onExpand).toHaveBeenCalledOnce();
});

it("moves to the next field immediately after typing while unrelated completion lookup is pending", () => {
  const { view } = editor(";x");
  expect(press(view, "Tab")).toBe(true);
  view.dispatch({
    ...view.state.replaceSelection("Alice"),
    userEvent: "input.type",
  });
  expect(completionStatus(view.state)).toBe("pending");
  expect(press(view, "Tab")).toBe(true);
  expect(
    view.state.sliceDoc(
      view.state.selection.main.from,
      view.state.selection.main.to,
    ),
  ).toBe("Role");
});

it("expands a freshly typed trigger before an unrelated completion lookup finishes", () => {
  const { view, onExpand } = editor("");
  view.dispatch({
    ...view.state.replaceSelection(";x"),
    userEvent: "input.type",
  });
  expect(completionStatus(view.state)).toBe("pending");
  expect(press(view, "Tab")).toBe(true);
  expect(onExpand).toHaveBeenCalledOnce();
  expect(view.state.doc.toString()).toBe("Name Role");
});
it.each([
  "word;x",
  "\\;x",
  "`;x`",
  "```md\n;x",
  "    ;x",
  "---\n;x",
  "[link](;x)",
])("keeps protected input literal: %j", (source) => {
  const { view, onExpand } = editor(source, source.indexOf(";x") + 2);
  press(view, " ");
  expect(onExpand).not.toHaveBeenCalled();
  expect(view.state.doc.toString()).toBe(source);
});
it("retains the entire Unicode boundary of the longest supported trigger", () => {
  const { view, onExpand } = editor("𐐀" + "s".repeat(64));
  press(view, "Tab");
  expect(onExpand).not.toHaveBeenCalled();
});
it("lets an active field own Tab even when its text is a trigger, above table navigation", () => {
  const { view, onExpand } = editor("| ;x | other |", 4);
  expect(press(view, "Tab")).toBe(true);
  expect(onExpand).toHaveBeenCalledOnce();
  view.dispatch(view.state.replaceSelection(";x"));
  expect(press(view, "Tab")).toBe(true);
  expect(onExpand).toHaveBeenCalledOnce();
  expect(
    view.state.sliceDoc(
      view.state.selection.main.from,
      view.state.selection.main.to,
    ),
  ).toBe("Role");
});
it("leaves selected, read-only and composing source untouched", () => {
  for (const kind of ["selected", "readonly", "composing"]) {
    const { view, onExpand } = editor(";x");
    if (kind === "selected")
      view.dispatch({ selection: { anchor: 0, head: 2 } });
    if (kind === "readonly")
      view.setState(
        EditorState.create({
          doc: ";x",
          selection: { anchor: 2 },
          extensions: [
            markdown(),
            EditorState.readOnly.of(true),
            createSnippetTriggers({ index, onExpand }),
          ],
        }),
      );
    if (kind === "composing")
      vi.spyOn(view, "compositionStarted", "get").mockReturnValue(true);
    press(view, "Tab");
    expect(onExpand).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe(";x");
  }
});

it.each(["Tab", " "])(
  "defers %j to an eligible slash query instead of expanding only its trigger suffix",
  (key) => {
    const { view, onExpand } = editor("/;x");
    expect(press(view, key)).toBe(false);
    expect(onExpand).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe("/;x");
  },
);
it("defers native Space input while a slash query owns the insertion", () => {
  const { view, onExpand } = editor("/;x");
  expect(
    view.state
      .facet(EditorView.inputHandler)
      .some((handler) =>
        handler(view, 3, 3, " ", () =>
          view.state.update({ changes: { from: 3, insert: " " } }),
        ),
      ),
  ).toBe(false);
  expect(onExpand).not.toHaveBeenCalled();
});
it("retains ordinary snippet activation after a literal slash and whitespace", () => {
  const { view, onExpand } = editor("/ ;x");
  expect(press(view, " ")).toBe(true);
  expect(onExpand).toHaveBeenCalledOnce();
  expect(view.state.doc.toString()).toBe("/ Name Role");
});
