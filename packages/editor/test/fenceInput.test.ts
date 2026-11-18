import { undo, redo } from "@codemirror/commands";
import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSlateMarkdownExtensions } from "../src/index";
import {
  enterEditorFence,
  chooseEditorFenceLanguage,
  type EditorFenceRequest,
} from "../src/fenceInput";

const fence = String.fromCharCode(96).repeat(3);
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
function editor(source: string, head = source.length) {
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({
      doc: source,
      selection: { anchor: head },
      extensions: createSlateMarkdownExtensions(),
    }),
  });
  views.push(view);
  return view;
}

it.each([
  [fence, fence + "\n\n" + fence, 4],
  [fence + "rust", fence + "rust\n\n" + fence, 8],
  [
    fence + String.fromCharCode(96),
    fence + String.fromCharCode(96) + "\n\n" + fence + String.fromCharCode(96),
    5,
  ],
  ["~~~", "~~~\n\n~~~", 4],
  ["  " + fence, "  " + fence + "\n  \n  " + fence, 8],
  ["> " + fence, "> " + fence + "\n> \n> " + fence, 8],
  ["> - " + fence, "> - " + fence + "\n>   \n>   " + fence, 12],
  ["---", "---\n\n---", 4],
  ["\uFEFF---", "\uFEFF---\n\n---", 5],
])("completes markup in one undo: %j", (source, expected, head) => {
  const view = editor(source);
  expect(enterEditorFence(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(expected);
  expect(view.state.selection.main.head).toBe(head);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(source);
  expect(redo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(expected);
});

it("keeps following words outside the newly closed fence", () => {
  const view = editor(fence + "\nKeep these words.", 3);
  expect(enterEditorFence(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(
    fence + "\n\n" + fence + "\nKeep these words.",
  );
});

it.each([
  ["    " + fence, 7],
  ["Words " + fence, 9],
  [fence + "\ncode\n" + fence, 3],
  [fence + "\ncode\n" + fence, 11],
  ["<!--\n" + fence, 8],
  ["---\ncode: " + fence, 13],
  ["Words\n---", 9],
  ["---\ntitle: Kept\n---", 3],
])(
  "keeps literal, already closed and protected markup unchanged: %j",
  (source, head) => {
    const view = editor(source, head);
    expect(enterEditorFence(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(source);
  },
);

it("respects independent settings, read-only, composition and multiple selections", () => {
  const view = editor(fence);
  expect(enterEditorFence(view, { fences: false })).toBe(false);
  const frontmatter = editor("---");
  expect(enterEditorFence(frontmatter, { frontmatter: false })).toBe(false);
  const readonly = editor(fence);
  readonly.dispatch({
    effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)),
  });
  expect(enterEditorFence(readonly)).toBe(false);
  const composing = editor(fence);
  Object.defineProperty(composing, "compositionStarted", { value: true });
  expect(enterEditorFence(composing)).toBe(false);
  view.dispatch({
    effects: StateEffect.appendConfig.of(
      EditorState.allowMultipleSelections.of(true),
    ),
    selection: EditorSelection.create([
      EditorSelection.cursor(0),
      EditorSelection.cursor(3),
    ]),
  });
  expect(enterEditorFence(view)).toBe(false);
});

it("amends language after a long picker delay as one edit and emits one combined view update", () => {
  const view = editor(fence);
  let request!: EditorFenceRequest;
  expect(
    enterEditorFence(view, {
      onPickLanguage: (_view, input) => {
        request = input;
      },
    }),
  ).toBe(true);
  const updates: string[] = [];
  view.dispatch({
    effects: StateEffect.appendConfig.of(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) updates.push(update.state.doc.toString());
      }),
    ),
  });
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
  expect(chooseEditorFenceLanguage(view, request, "rust")).toBe(true);
  expect(view.state.doc.toString()).toBe(fence + "rust\n\n" + fence);
  expect(updates).toEqual([fence + "rust\n\n" + fence]);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(fence);
  expect(redo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(fence + "rust\n\n" + fence);
  expect(chooseEditorFenceLanguage(view, request, "go")).toBe(false);
});

it("handles a synchronized rapid Enter before a platform listener defers the key", () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (Linux; Android 13) Chrome/150.0 Mobile",
  );
  const view = editor(fence);
  view.focus();
  const platform = vi.fn((event: Event) => {
    if (!event.defaultPrevented) event.stopImmediatePropagation();
  });
  view.contentDOM.addEventListener("keydown", platform, true);
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    keyCode: 13,
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(view.state.doc.toString()).toBe(fence + "\n\n" + fence);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(fence);
});

it("leaves unobserved DOM input for the platform instead of overwriting newer words", () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (Linux; Android 13) Chrome/150.0 Mobile",
  );
  const view = editor(fence);
  view.focus();
  const line = view.contentDOM.querySelector(".cm-line")!;
  line.append(" keep pending words");
  view.contentDOM.addEventListener(
    "keydown",
    (event) => event.stopImmediatePropagation(),
    true,
  );
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    keyCode: 13,
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(view.state.doc.toString()).toBe(fence);
  expect(line.textContent).toBe(fence + " keep pending words");
});

it("rejects stale or invalid language choices without replacing later writing", () => {
  const view = editor(fence);
  let request!: EditorFenceRequest;
  enterEditorFence(view, {
    onPickLanguage: (_view, input) => {
      request = input;
    },
  });
  expect(chooseEditorFenceLanguage(view, request, "rust\nunsafe")).toBe(false);
  view.dispatch({ changes: { from: 4, insert: "Kept" } });
  const source = view.state.doc.toString();
  expect(chooseEditorFenceLanguage(view, request, "rust")).toBe(false);
  expect(view.state.doc.toString()).toBe(source);
});
