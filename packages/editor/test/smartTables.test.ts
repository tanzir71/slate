import { undo, redo } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  Transaction,
  type Extension,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it, vi } from "vitest";
import { createSlateMarkdownExtensions } from "../src/index";
import {
  navigateTableCell,
  enterEditorTable,
  formatEditorTable,
  editorTableColumns,
  runTableCommand,
} from "../src/smartTables";

const views: EditorView[] = [];
function editor(marked: string, extra: Extension[] = []) {
  const anchor = marked.indexOf("¦"),
    end = marked.indexOf("¦", anchor + 1);
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({
      doc: marked.replaceAll("¦", ""),
      selection: { anchor, head: end < 0 ? anchor : end - 1 },
      extensions: [createSlateMarkdownExtensions(), ...extra],
    }),
  });
  views.push(view);
  return view;
}
function marked(view: EditorView) {
  const source = view.state.doc.toString(),
    range = view.state.selection.main;
  return source.slice(0, range.head) + "¦" + source.slice(range.head);
}
afterEach(() => {
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
});

it.each(["", "> ", "- ", "> - "])(
  "creates a separator and body after a bare header in %s",
  (prefix) => {
    const view = editor(prefix + "| a | b |¦");
    expect(enterEditorTable(view)).toBe(true);
    const nextPrefix = prefix.replace(/[-+] /, "  ");
    expect(marked(view)).toBe(
      prefix +
        "| a   | b   |\n" +
        nextPrefix +
        "| --- | --- |\n" +
        nextPrefix +
        "| ¦    |     |",
    );
    expect(undo(view)).toBe(true);
    expect(marked(view)).toBe(prefix + "| a | b |¦");
    expect(redo(view)).toBe(true);
    expect(editorTableColumns(view.state)).toBe(2);
  },
);
it("formats and moves through cells, skipping the separator", () => {
  const view = editor("| a¦ | beta |\n|-|:-:|\n| x | y |");
  expect(navigateTableCell(view, 1)).toBe(true);
  expect(marked(view)).toBe(
    "| a   | ¦beta  |\n| --- | :---: |\n| x   | y     |",
  );
  expect(navigateTableCell(view, 1)).toBe(true);
  expect(marked(view)).toContain("\n| ¦x   | y     |");
  expect(navigateTableCell(view, -1)).toBe(true);
  expect(marked(view)).toContain("| a   | ¦beta  |");
});
it("appends a body row at the end with one undo", () => {
  const source = "| A | B |\n|---|---|\n| x | y¦ |";
  const view = editor(source);
  expect(navigateTableCell(view, 1)).toBe(true);
  expect(marked(view)).toBe(
    "| A   | B   |\n| --- | --- |\n| x   | y   |\n| ¦    |     |",
  );
  expect(undo(view)).toBe(true);
  expect(marked(view)).toBe(source);
});
it("creates a first body row after a header-only table", () => {
  const view = editor("| a | b¦ |\n|-|-|");
  expect(navigateTableCell(view, 1)).toBe(true);
  expect(marked(view)).toBe("| a   | b   |\n| --- | --- |\n| ¦    |     |");
});
it.each(["", "> ", "  "])(
  "Enter adds a row without splitting inline text with prefix %s",
  (prefix) => {
    const view = editor(
      prefix + "| aa | bb |\n" + prefix + "|-|-|\n" + prefix + "| x | y¦z |",
    );
    expect(enterEditorTable(view)).toBe(true);
    expect(marked(view)).toBe(
      prefix +
        "| aa  | bb  |\n" +
        prefix +
        "| --- | --- |\n" +
        prefix +
        "| x   | yz  |\n" +
        prefix +
        "|     | ¦    |",
    );
  },
);
it("preserves escaped pipes, code, Unicode and excess body cells", () => {
  const view = editor(
    "| Café | `x\\|y` |\n|:--|--:|\n| x\\|y | বাংলা¦ | extra |",
  );
  expect(formatEditorTable(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(
    "| Café | `x\\|y` |\n| :--- | -----: |\n| x\\|y | বাংলা  | extra |",
  );
  expect(marked(view)).toContain("বাংলা¦");
  expect(formatEditorTable(view)).toBe(true);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(
    "| Café | `x\\|y` |\n|:--|--:|\n| x\\|y | বাংলা | extra |",
  );
  expect(undo(view)).toBe(false);
});
it("preserves a backwards selection through padding changes", () => {
  const view = editor("| a¦ | beta |\n|-|-|\n| x | y¦ |");
  const range = view.state.selection.main;
  view.dispatch({ selection: { anchor: range.head, head: range.anchor } });
  expect(formatEditorTable(view)).toBe(true);
  expect(view.state.selection.main.anchor).toBe(
    view.state.doc.toString().indexOf("y") + 1,
  );
  expect(view.state.selection.main.head).toBe(3);
});
it("lets Shift-Tab escape the first cell without edits or history", () => {
  const view = editor("| ¦a | b |\n|-|-|");
  expect(navigateTableCell(view, -1)).toBe(false);
  expect(view.state.doc.toString()).toBe("| a | b |\n|-|-|");
  expect(undo(view)).toBe(false);
});
it.each([
  "```md\n| a | b |¦\n```",
  "    | a | b |¦",
  "---\n| a | b |¦\n---",
  "<div>\n| a | b |¦\n</div>",
  "paragraph | a | b |¦",
  "| a | b |¦ more",
])("leaves excluded bare input unchanged: %s", (source) => {
  const view = editor(source);
  expect(enterEditorTable(view)).toBe(false);
  expect(navigateTableCell(view, 1)).toBe(false);
  expect(formatEditorTable(view)).toBe(false);
  expect(undo(view)).toBe(false);
});
it("refuses read-only, selected and multiple cursors without edits", () => {
  const source = "| a¦ | b |\n|-|-|";
  const readOnly = editor(source, [EditorState.readOnly.of(true)]);
  expect(enterEditorTable(readOnly)).toBe(false);
  expect(navigateTableCell(readOnly, 1)).toBe(false);
  expect(formatEditorTable(readOnly)).toBe(false);
  const selected = editor("| ¦a¦ | b |\n|-|-|");
  expect(enterEditorTable(selected)).toBe(false);
  expect(navigateTableCell(selected, 1)).toBe(false);
  const multiple = editor(source, [
    EditorState.allowMultipleSelections.of(true),
  ]);
  multiple.dispatch({
    selection: EditorSelection.create([
      EditorSelection.cursor(2),
      EditorSelection.cursor(6),
    ]),
  });
  expect(enterEditorTable(multiple)).toBe(false);
  expect(navigateTableCell(multiple, 1)).toBe(false);
  expect(formatEditorTable(multiple)).toBe(false);
});
it("isolates structural table changes from preceding typing", () => {
  const view = editor("| a | ¦ |\n|-|-|");
  view.dispatch({
    changes: { from: 6, insert: "typed" },
    selection: { anchor: 11 },
    annotations: Transaction.userEvent.of("input.type"),
  });
  expect(navigateTableCell(view, 1)).toBe(true);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("| a | typed |\n|-|-|");
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("| a |  |\n|-|-|");
});
it("does not depend on background parser time slices", () => {
  let elapsed = 0;
  const clock = vi
    .spyOn(Date, "now")
    .mockImplementation(() => (elapsed += 100));
  try {
    const view = editor("| a¦ | b |\n|-|-|\n| x | y |");
    expect(navigateTableCell(view, 1)).toBe(true);
    expect(marked(view)).toContain("| a   | ¦b   |");
  } finally {
    clock.mockRestore();
  }
});

it("navigates the padded cells of a short body row before appending", () => {
  const view = editor("| a | b | c |\n|-|-|-|\n| x¦ |");
  expect(navigateTableCell(view, 1)).toBe(true);
  expect(marked(view)).toBe(
    "| a   | b   | c   |\n| --- | --- | --- |\n| x   | ¦    |     |",
  );
  expect(navigateTableCell(view, 1)).toBe(true);
  expect(marked(view)).toContain("| x   |     | ¦    |");
});
it.each([
  [
    "table.insertBefore",
    "| A   |     | B   |\n| --- | --- | --- |\n| x   | ¦    | y   |",
  ],
  [
    "table.insertAfter",
    "| A   | B   |     |\n| --- | --- | --- |\n| x   | y   | ¦    |",
  ],
  ["table.deleteColumn", "| A   |\n| --- |\n| ¦x   |"],
  ["table.align.left", "| A   | B    |\n| --- | :--- |\n| x   | ¦y    |"],
  ["table.align.center", "| A   | B     |\n| --- | :---: |\n| x   | ¦y     |"],
  ["table.align.right", "| A   | B    |\n| --- | ---: |\n| x   | ¦y    |"],
  ["table.align.none", "| A   | B   |\n| --- | --- |\n| x   | ¦y   |"],
])("runs %s as one isolated edit", (id, expected) => {
  const source = "| A | B |\n|-|-|\n| x | y¦ |";
  const view = editor(source);
  expect(runTableCommand(view, id)).toBe(true);
  expect(marked(view), "after command").toBe(expected);
  expect(undo(view)).toBe(true);
  expect(marked(view)).toBe(source);
  expect(redo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(expected.replace("¦", ""));
});
it("refuses removing the sole column, unknown commands and non-table positions", () => {
  const view = editor("| a¦ |\n|-|");
  expect(editorTableColumns(view.state)).toBe(1);
  expect(runTableCommand(view, "table.deleteColumn")).toBe(false);
  expect(runTableCommand(view, "table.align.invalid")).toBe(false);
  expect(runTableCommand(view, "format.bold")).toBe(false);
  expect(runTableCommand(editor("ordinary¦"), "table.insertAfter")).toBe(false);
  expect(undo(view)).toBe(false);
});

it("formats only edited tables on blur in one transaction, preserving outside selection", async () => {
  const { tableBlurFormatting, formatEditedTables } =
    await import("../src/tableBlur");
  const view = editor(
    "Before\n\n| a | b |\n|-|-|\n| x¦ | y |\n\n| Untouched | B |\n|-|-|\n| M | N |\n\nAfter",
    [tableBlurFormatting],
  );
  const from = view.state.selection.main.head;
  view.dispatch({
    changes: { from, insert: " words" },
    annotations: Transaction.userEvent.of("input.type"),
  });
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  const source = view.state.doc.toString();
  expect(formatEditedTables(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(
    "Before\n\n| a       | b   |\n| ------- | --- |\n| x words | y   |\n\n| Untouched | B |\n|-|-|\n| M | N |\n\nAfter",
  );
  expect(view.state.selection.main.head).toBe(view.state.doc.length);
  expect(formatEditedTables(view)).toBe(false);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(source);
  expect(formatEditedTables(view)).toBe(false);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(source.replace("x words", "x"));
});
it("formats multiple edited tables from a paste and preserves a backwards cell selection", async () => {
  const { tableBlurFormatting, formatEditedTables } =
    await import("../src/tableBlur");
  const view = editor("¦", [tableBlurFormatting]);
  const source =
    "| a | b |\n|-|-|\n| x | y |\n\n| aa | bb |\n|-|-|\n| xx | yy |";
  view.dispatch({
    changes: { from: 0, insert: source },
    annotations: Transaction.userEvent.of("input.paste"),
  });
  view.dispatch({
    selection: { anchor: source.indexOf("yy") + 2, head: source.indexOf("xx") },
  });
  expect(formatEditedTables(view)).toBe(true);
  expect(view.state.selection.main.anchor).toBe(
    view.state.doc.toString().indexOf("yy") + 2,
  );
  expect(view.state.selection.main.head).toBe(
    view.state.doc.toString().indexOf("xx"),
  );
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(source);
});
it("never formats untouched or externally refreshed tables and never scans ordinary input", async () => {
  const { tableBlurFormatting, formatEditedTables } =
    await import("../src/tableBlur");
  const view = editor("| a¦ | b |\n|-|-|", [tableBlurFormatting]);
  expect(formatEditedTables(view)).toBe(false);
  view.dispatch({
    changes: { from: 2, insert: "external" },
    annotations: Transaction.addToHistory.of(false),
  });
  expect(formatEditedTables(view)).toBe(false);
  const line = vi.spyOn(view.state.doc, "lineAt");
  // Exercise the field without the view's own layout/decoration reads.
  const state = view.state.update({
    changes: { from: 2, insert: "typed" },
    annotations: Transaction.userEvent.of("input.type"),
  }).state;
  expect(state.doc.length).toBe(view.state.doc.length + 5);
  expect(line).not.toHaveBeenCalled();
  line.mockRestore();
});

it("gives table keys priority over list indentation and allows Shift-Tab to escape", async () => {
  const { runScopeHandlers } = await import("@codemirror/view");
  const source = "- Before\n- | ¦a | b |\n  |-|-|\n  | x | y |";
  const view = editor(source);
  expect(
    runScopeHandlers(
      view,
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }),
      "editor",
    ),
  ).toBe(false);
  expect(marked(view)).toBe(source);
  expect(
    runScopeHandlers(
      view,
      new KeyboardEvent("keydown", { key: "Tab" }),
      "editor",
    ),
  ).toBe(true);
  expect(marked(view)).toContain("- | a   | ¦b   |");
  expect(
    runScopeHandlers(
      view,
      new KeyboardEvent("keydown", { key: "Enter" }),
      "editor",
    ),
  ).toBe(true);
  expect(marked(view)).toContain("\n  |     | ¦    |\n  | x   | y   |");
});
it("does not format a table when only an adjoining paragraph was edited", async () => {
  const { formatEditedTables } = await import("../src/tableBlur");
  const view = editor("| a | b |\n|-|-|\n\nWords¦");
  view.dispatch({
    changes: { from: view.state.doc.length, insert: " extra" },
    annotations: Transaction.userEvent.of("input.type"),
  });
  expect(formatEditedTables(view)).toBe(false);
  expect(view.state.doc.toString()).toBe("| a | b |\n|-|-|\n\nWords extra");
});
it("keeps composition input unchanged until composition has finished", () => {
  const view = editor("| a | b |¦");
  Object.defineProperty(view, "compositionStarted", {
    configurable: true,
    value: true,
  });
  expect(enterEditorTable(view)).toBe(false);
  expect(navigateTableCell(view, 1)).toBe(false);
  expect(runTableCommand(view, "table.format")).toBe(false);
  expect(undo(view)).toBe(false);
});

it("retains another edited table's blur work after a table command", async () => {
  const { formatEditedTables } = await import("../src/tableBlur");
  const view = editor("| a¦ | b |\n|-|-|\n\n| c | d |\n|-|-|");
  view.dispatch({
    changes: { from: 3, insert: "long" },
    annotations: Transaction.userEvent.of("input.type"),
  });
  view.dispatch({
    selection: { anchor: view.state.doc.toString().indexOf("c") },
  });
  expect(navigateTableCell(view, 1)).toBe(true);
  expect(formatEditedTables(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(
    "| along | b   |\n| ----- | --- |\n\n| c   | d   |\n| --- | --- |",
  );
});
