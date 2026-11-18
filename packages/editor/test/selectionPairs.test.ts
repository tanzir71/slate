import { undo } from "@codemirror/commands";
import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it } from "vitest";
import { createSlateMarkdownExtensions } from "../src/index";
import { createSelectionPairs, planSelectionPair } from "../src/selectionPairs";

const views: EditorView[] = [];
function editor(doc: string, from = 0, to = doc.length, enabled = true) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: from, head: to },
      extensions: [
        createSlateMarkdownExtensions({ selectionPairs: false }),
        createSelectionPairs(enabled),
      ],
    }),
  });
  views.push(view);
  return view;
}
function input(view: EditorView, text: string, event = "input.type") {
  const { from, to } = view.state.selection.main;
  const normal = () =>
    view.state.update({
      changes: { from, to, insert: text },
      userEvent: event,
    });
  return view.state
    .facet(EditorView.inputHandler)
    .some((handler) => handler(view, from, to, text, normal));
}
afterEach(() => {
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
});

it.each([
  ["*", "*words*", 1],
  ["_", "_words_", 1],
  ["`", "`words`", 1],
  ["~", "~~words~~", 2],
  ["~~", "~~words~~", 2],
  ["=", "==words==", 2],
  ["==", "==words==", 2],
  ["[", "[words]", 1],
  ["(", "(words)", 1],
])(
  "wraps with %s, keeps the words selected and restores them with one undo",
  (text, expected, offset) => {
    const view = editor("words");
    expect(input(view, text)).toBe(true);
    expect(view.state.doc.toString()).toBe(expected);
    expect(view.state.selection.main.anchor).toBe(offset);
    expect(view.state.selection.main.head).toBe(offset + 5);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("words");
    expect(view.state.selection.main.anchor).toBe(0);
    expect(view.state.selection.main.head).toBe(5);
    expect(undo(view)).toBe(false);
  },
);

it("uses safe backtick fences, preserves Unicode and reverses no selection", () => {
  const view = editor("`বাংলা 🌿`", 10, 0);
  expect(input(view, "`")).toBe(true);
  expect(view.state.doc.toString()).toBe("`` `বাংলা 🌿` ``");
  expect(view.state.selection.main.anchor).toBe(13);
  expect(view.state.selection.main.head).toBe(3);
  undo(view);
  expect(view.state.doc.toString()).toBe("`বাংলা 🌿`");
});

it("wraps a large selection containing many code spans without losing source", () => {
  const doc = "`x` ".repeat(75_000);
  const state = EditorState.create({
    doc,
    selection: { anchor: 0, head: doc.length },
  });
  const transaction = planSelectionPair(state, "`")!;
  expect(transaction.state.doc.toString()).toBe("`` " + doc + " ``");
  expect(
    transaction.state.sliceDoc(
      transaction.newSelection.main.from,
      transaction.newSelection.main.to,
    ),
  ).toBe(doc);
});

it.each(["~", "="])(
  "consumes the second typed %s without adding a second undo step",
  (text) => {
    const view = editor("words");
    expect(input(view, text)).toBe(true);
    const second = new KeyboardEvent("keydown", {
      key: text,
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(true);
    const later = new KeyboardEvent("keydown", {
      key: text,
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
    expect(view.state.doc.toString()).toBe(
      text.repeat(2) + "words" + text.repeat(2),
    );
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("words");
  },
);

it("isolates wrapping from earlier typing, supports multiple ranges and preserves their direction", () => {
  const view = editor("one two");
  view.dispatch({
    changes: { from: 7, insert: "!" },
    userEvent: "input.type",
    selection: { anchor: 0, head: 7 },
  });
  expect(input(view, "[")).toBe(true);
  undo(view);
  expect(view.state.doc.toString()).toBe("one two!");
  undo(view);
  expect(view.state.doc.toString()).toBe("one two");
  const state = EditorState.create({
    doc: "one two",
    selection: EditorSelection.create([
      EditorSelection.range(3, 0),
      EditorSelection.range(4, 7),
    ]),
    extensions: EditorState.allowMultipleSelections.of(true),
  });
  const transaction = planSelectionPair(state, "(")!;
  expect(transaction.state.doc.toString()).toBe("(one) (two)");
  expect(
    transaction.newSelection.ranges.map((range) => [range.anchor, range.head]),
  ).toEqual([
    [4, 1],
    [7, 10],
  ]);
});

it("refuses ordinary text, empty or mixed selections, readonly states, disabled rules and pasted delimiters", () => {
  for (const text of ["a", "]", "**", "***"])
    expect(input(editor("words"), text)).toBe(false);
  expect(input(editor("words", 2, 2), "[")).toBe(false);
  expect(input(editor("words", 0, 5, false), "[")).toBe(false);
  expect(input(editor("words"), "[", "input.paste")).toBe(false);
  expect(input(editor("words"), "[", "input.type.compose")).toBe(false);
  const locked = EditorState.create({
    doc: "words",
    selection: { anchor: 0, head: 5 },
    extensions: EditorState.readOnly.of(true),
  });
  expect(planSelectionPair(locked, "[")).toBeUndefined();
  const mixed = EditorState.create({
    doc: "one two",
    selection: EditorSelection.create([
      EditorSelection.range(0, 3),
      EditorSelection.cursor(7),
    ]),
    extensions: EditorState.allowMultipleSelections.of(true),
  });
  expect(planSelectionPair(mixed, "[")).toBeUndefined();
});

it("consumes a mobile beforeinput repetition and clears pending state after a caret move", () => {
  const view = editor("words");
  input(view, "=");
  const second = new InputEvent("beforeinput", {
    inputType: "insertText",
    data: "=",
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(second);
  expect(second.defaultPrevented).toBe(true);
  expect(view.state.doc.toString()).toBe("==words==");
  undo(view);
  input(view, "=");
  view.dispatch({ selection: { anchor: 3, head: 5 } });
  const later = new InputEvent("beforeinput", {
    inputType: "insertText",
    data: "=",
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(later);
  expect(later.defaultPrevented).toBe(false);
});

it("retains the complete pair when a mobile input event cannot be cancelled", () => {
  const view = editor("words");
  input(view, "~");
  const event = new InputEvent("beforeinput", {
    inputType: "insertText",
    data: "~",
    bubbles: true,
    cancelable: false,
  });
  view.contentDOM.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(input(view, "~")).toBe(true);
  expect(view.state.doc.toString()).toBe("~~words~~");
  expect(view.state.selection.main.from).toBe(2);
  expect(view.state.selection.main.to).toBe(7);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("words");
  expect(undo(view)).toBe(false);
});

it("does not consume composition, modified keys or paste, and survives unrelated reconfiguration", () => {
  const view = editor("words");
  input(view, "~");
  for (const options of [
    { key: "~", isComposing: true },
    { key: "~", ctrlKey: true },
    { key: "~", metaKey: true },
    { key: "~", altKey: true },
  ]) {
    const event = new KeyboardEvent("keydown", {
      ...options,
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  for (const options of [
    { inputType: "insertFromPaste", data: "~" },
    { inputType: "insertText", data: "~", isComposing: true },
    { inputType: "insertText", data: "~", cancelable: false },
  ]) {
    const event = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      ...options,
    });
    view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  view.dispatch({
    effects: StateEffect.appendConfig.of(EditorState.tabSize.of(8)),
  });
  const continued = new InputEvent("beforeinput", {
    inputType: "insertText",
    data: "~",
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(continued);
  expect(continued.defaultPrevented).toBe(true);
});
