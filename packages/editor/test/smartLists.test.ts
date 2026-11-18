import { undo } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSlateMarkdownExtensions,
  indentEditorListItem,
  moveEditorListItem,
  type SmartListOptions,
} from "../src/index";

const views: EditorView[] = [];
function marked(text: string) {
  const anchor = text.indexOf("¦");
  const end = text.indexOf("¦", anchor + 1);
  return {
    doc: text.replaceAll("¦", ""),
    selection: { anchor, head: end < 0 ? anchor : end - 1 },
  };
}
function editor(
  text: string,
  options?: SmartListOptions | false,
  extensions: Extension[] = [],
) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      ...marked(text),
      extensions: [
        createSlateMarkdownExtensions({
          formattingKeys: false,
          smartLists: options,
        }),
        ...extensions,
      ],
    }),
  });
  views.push(view);
  return view;
}
function key(view: EditorView, name: string) {
  const parts = name.split("-");
  return runScopeHandlers(
    view,
    new KeyboardEvent("keydown", {
      key: parts.at(-1),
      altKey: parts.includes("Alt"),
      shiftKey: parts.includes("Shift"),
      bubbles: true,
    }),
    "editor",
  );
}
function expectMarked(view: EditorView, text: string) {
  const expected = marked(text);
  expect(view.state.doc.toString()).toBe(expected.doc);
  expect(view.state.selection.main.anchor).toBe(expected.selection.anchor);
  expect(view.state.selection.main.head).toBe(expected.selection.head);
}
afterEach(() => {
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
});

describe("smart list keys", () => {
  it("renumbers every sibling even when the background parser exhausts its time slice", () => {
    let elapsed = 0;
    const clock = vi
      .spyOn(Date, "now")
      .mockImplementation(() => (elapsed += 100));
    try {
      const view = editor("7. A\n8. ¦B\n9. C¦\n10. D");
      const range = view.state.selection.main;
      view.dispatch({ selection: { anchor: range.head, head: range.anchor } });
      expect(moveEditorListItem(view, -1)).toBe(true);
      expect(view.state.doc.toString()).toBe("7. B\n8. C\n9. A\n10. D");
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("7. A\n8. B\n9. C\n10. D");
    } finally {
      clock.mockRestore();
    }
  });

  it("continues and renumbers a list independently of parser scheduling", () => {
    let elapsed = 0;
    const clock = vi
      .spyOn(Date, "now")
      .mockImplementation(() => (elapsed += 100));
    try {
      const view = editor("9. Alpha¦\n10. Beta");
      expect(key(view, "Enter")).toBe(true);
      expectMarked(view, "9. Alpha\n10. ¦\n11. Beta");
      expect(undo(view)).toBe(true);
      expectMarked(view, "9. Alpha¦\n10. Beta");
    } finally {
      clock.mockRestore();
    }
  });
  it.each([
    ["- Alpha¦", "Enter", "- Alpha\n- ¦"],
    ["- [x] Done¦", "Enter", "- [x] Done\n- [ ] ¦"],
    ["9. Alpha¦\n10. Beta", "Enter", "9. Alpha\n10. ¦\n11. Beta"],
    [
      "8. Alpha¦\n9. Beta\n   - Child",
      "Enter",
      "8. Alpha\n9. ¦\n10. Beta\n    - Child",
    ],
    ["1) Alpha¦\n2) Beta", "Enter", "1) Alpha\n2) ¦\n3) Beta"],
    ["> - Alpha¦", "Enter", "> - Alpha\n> - ¦"],
    ["- ¦", "Enter", "¦"],
    ["- ¦", "Backspace", "¦"],
    ["- A\n- B¦", "Tab", "- A\n  - B¦"],
    ["- A\n  - B¦", "Shift-Tab", "- A\n- B¦"],
    ["- A\n\t- B¦", "Shift-Tab", "- A\n- B¦"],
    ["> - A\n> \t- B¦", "Shift-Tab", "> - A\n> - B¦"],
    ["- A\n- B¦\n- C", "Alt-ArrowUp", "- B¦\n- A\n- C"],
    ["- A¦\n- B\n- C", "Alt-ArrowDown", "- B\n- A¦\n- C"],
    ["9. A¦\n10. B", "Alt-ArrowDown", "9. B\n10. A¦"],
    ["9. A¦\n   - Child\n10. B", "Alt-ArrowDown", "9. B\n10. A¦\n    - Child"],
    ["9. B\n10. A¦\n    - Child", "Alt-ArrowUp", "9. A¦\n   - Child\n10. B"],
    ["7. A\n8. B¦\n9. C", "Tab", "7. A\n   1. B¦\n8. C"],
    ["9. A\n   3. B¦\n10. C", "Shift-Tab", "9. A\n10. B¦\n11. C"],
    ["- A\n- B¦\n  - Child\n- C", "Tab", "- A\n  - B¦\n    - Child\n- C"],
    ["- A\n  - B¦\n    - Child\n- C", "Shift-Tab", "- A\n- B¦\n  - Child\n- C"],
    ["- A\n- B¦\n  - Child\n- C", "Alt-ArrowUp", "- B¦\n  - Child\n- A\n- C"],
    [
      "- A¦\n  > Quoted\n  > text\n- B",
      "Alt-ArrowDown",
      "- B\n- A¦\n  > Quoted\n  > text",
    ],
    ["- [x] A\n- [ ] B¦", "Tab", "- [x] A\n  - [ ] B¦"],
    ["> - A\n> - B¦\n>   - Child", "Tab", "> - A\n>   - B¦\n>     - Child"],
    ["> - A\n>   - B¦", "Shift-Tab", "> - A\n> - B¦"],
    [
      "> 9. A¦\n>    - Child\n> 10. B",
      "Alt-ArrowDown",
      "> 9. B\n> 10. A¦\n>     - Child",
    ],
    ["- A\n\n- B¦\n\n- C", "Alt-ArrowDown", "- A\n\n- C\n\n- B¦"],
    ["- A\n- বাংলা 🌿¦\n  - é", "Tab", "- A\n  - বাংলা 🌿¦\n    - é"],
    [
      "1. A\n   5. Child\n2. B¦\n3. C",
      "Tab",
      "1. A\n   5. Child\n   6. B¦\n2. C",
    ],
  ])(
    "%s + %s changes the document and caret in one undo",
    (before, shortcut, after) => {
      const view = editor(before);
      expect(key(view, shortcut)).toBe(true);
      expectMarked(view, after);
      expect(undo(view)).toBe(true);
      expectMarked(view, before);
      expect(undo(view)).toBe(false);
    },
  );

  it.each([
    ["- A\n¦- B\n- C¦\n- D", "Tab", "- A\n  ¦- B\n  - C¦\n- D"],
    ["- A\n¦- B\n- C¦\n- D", "Alt-ArrowUp", "¦- B\n- C¦\n- A\n- D"],
    ["- A\n¦- B\n- C¦\n- D", "Alt-ArrowDown", "- A\n- D\n¦- B\n- C¦"],
    ["- A\n¦- B\n¦- C", "Tab", "- A\n  ¦- B\n¦- C"],
  ])(
    "keeps a selected sibling group intact: %s + %s",
    (before, shortcut, after) => {
      const view = editor(before);
      expect(key(view, shortcut)).toBe(true);
      expectMarked(view, after);
      undo(view);
      expectMarked(view, before);
    },
  );

  it("preserves a reversed selection while moving and renumbering", () => {
    const view = editor("7. A\n8. ¦B\n9. C¦\n10. D");
    const selection = view.state.selection.main;
    view.dispatch({
      selection: { anchor: selection.head, head: selection.anchor },
    });
    expect(moveEditorListItem(view, -1)).toBe(true);
    expect(view.state.doc.toString()).toBe("7. B\n8. C\n9. A\n10. D");
    expect(
      view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ),
    ).toBe("B\n8. C");
    expect(view.state.selection.main.anchor).toBeGreaterThan(
      view.state.selection.main.head,
    );
    undo(view);
    expect(view.state.doc.toString()).toBe("7. A\n8. B\n9. C\n10. D");
    expect(view.state.selection.main.anchor).toBe(selection.head);
  });

  it("isolates smart edits from prior typing and from each other", () => {
    const view = editor("- A\n- B¦");
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "eta" },
      selection: { anchor: view.state.doc.length + 3 },
      userEvent: "input.type",
    });
    expect(key(view, "Tab")).toBe(true);
    expect(key(view, "Enter")).toBe(true);
    undo(view);
    expectMarked(view, "- A\n  - Beta¦");
    undo(view);
    expectMarked(view, "- A\n- Beta¦");
    undo(view);
    expectMarked(view, "- A\n- B¦");
  });

  it.each([
    "plain¦",
    "```\n- code¦\n```",
    "- A\n  ```\n  - code¦\n  ```",
    "<!--\n- html¦\n-->",
  ])("refuses structural edits outside a list item: %s", (before) => {
    const view = editor(before);
    for (const direction of [-1, 1] as const) {
      expect(indentEditorListItem(view, direction)).toBe(false);
      expect(moveEditorListItem(view, direction)).toBe(false);
    }
    expectMarked(view, before);
  });

  it("allows Tab to escape from the first item and Shift-Tab from a root list", () => {
    const view = editor("- A¦\n- B");
    expect(key(view, "Tab")).toBe(false);
    expect(key(view, "Shift-Tab")).toBe(false);
    expect(moveEditorListItem(view, -1)).toBe(true);
    expect(undo(view)).toBe(false);
    expectMarked(view, "- A¦\n- B");
  });

  it("does not intercept disabled rules, read-only edits or multiple selections", () => {
    const disabled = editor("- A\n- B¦", {
      continuation: false,
      indent: false,
      move: false,
    });
    for (const name of ["Tab", "Shift-Tab"])
      expect(key(disabled, name)).toBe(false);
    key(disabled, "Enter");
    expectMarked(disabled, "- A\n- B\n¦");
    const ordinary = editor("- A\n- B¦\n  - Child", { move: false });
    key(ordinary, "Alt-ArrowUp");
    expectMarked(ordinary, "- B¦\n- A\n  - Child");
    const locked = editor("- A\n- B¦", {}, [EditorState.readOnly.of(true)]);
    for (const name of [
      "Tab",
      "Shift-Tab",
      "Alt-ArrowUp",
      "Alt-ArrowDown",
      "Enter",
      "Backspace",
    ])
      key(locked, name);
    expectMarked(locked, "- A\n- B¦");
    const multiple = editor("- A\n- B¦", {}, [
      EditorState.allowMultipleSelections.of(true),
    ]);
    multiple.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(3),
        EditorSelection.cursor(7),
      ]),
    });
    expect(indentEditorListItem(multiple, 1)).toBe(false);
    expect(moveEditorListItem(multiple, 1)).toBe(false);
  });
});
