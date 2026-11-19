import { editorBlockQuery } from "./blockInsertion.js";
import { completionStatus } from "@codemirror/autocomplete";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  matchSnippet,
  type ScopedSnippet,
  type SnippetIndex,
} from "@slate/core";
import {
  requestEditorSnippet,
  type EditorSnippetRequest,
} from "./snippetInsertion.js";

export interface SnippetTriggerOptions {
  readonly index: SnippetIndex;
  readonly onExpand: (
    view: EditorView,
    request: EditorSnippetRequest,
    snippet: ScopedSnippet,
  ) => boolean;
}

/** Cached suffix lookup comes before syntax parsing; ordinary whitespace stays cheap. */
export function createSnippetTriggers({
  index,
  onExpand,
}: SnippetTriggerOptions) {
  function expand(view: EditorView, activation: "tab" | "space") {
    const { state } = view,
      { main } = state.selection;
    if (
      !index.maxLength ||
      state.readOnly ||
      view.compositionStarted ||
      !state.facet(EditorView.editable) ||
      state.selection.ranges.length !== 1 ||
      !main.empty ||
      (activation === "tab" && completionStatus(state) === "active")
    )
      return false;
    // Two UTF-16 units retain an astral letter at the longest trigger's boundary.
    const before = state.sliceDoc(
      Math.max(0, main.head - index.maxLength - 2),
      main.head,
    );
    const definition = matchSnippet(index, before, activation);
    // A slash query owns activation keys, including native Space without keydown.
    if (!definition || editorBlockQuery(state)) return false;
    const request = requestEditorSnippet(
      state,
      main.head - definition.trigger.length,
    );
    return !!request && onExpand(view, request, definition);
  }
  return [
    Prec.highest(
      keymap.of([
        { key: "Tab", run: (view) => expand(view, "tab") },
        { key: "Space", run: (view) => expand(view, "space") },
      ]),
    ),
    EditorView.inputHandler.of(
      (view, from, to, text) =>
        text === " " &&
        from === to &&
        from === view.state.selection.main.head &&
        expand(view, "space"),
    ),
  ];
}
