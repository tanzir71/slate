import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo, redo } from "@codemirror/commands";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSlateMarkdownExtensions } from "../src/index";
import {
  editorBlockTarget,
  insertEditorBlockAt,
  moveEditorBlock,
} from "../src/editorBlocks";

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
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({
      doc: source,
      extensions: createSlateMarkdownExtensions(),
    }),
  });
  views.push(view);
  return view;
}
it("targets a whole list from a nested child and caches only the immutable document", () => {
  const source = "Intro\n\n- Parent\n  - child\n- Other\n\nTail";
  const view = editor(source);
  const first = editorBlockTarget(view.state, source.indexOf("child"))!;
  expect(first.block.kind).toBe("list");
  expect(source.slice(first.block.from, first.block.to)).toBe(
    "- Parent\n  - child\n- Other",
  );
  const second = editorBlockTarget(view.state, source.length)!;
  expect(second.document).toBe(first.document);
  view.dispatch({ changes: { from: source.length, insert: " words" } });
  expect(editorBlockTarget(view.state, source.length)!.document).not.toBe(
    first.document,
  );
});
it("keeps metadata protected and exposes an empty body line for insertion", () => {
  const source = "---\ntitle: Kept\n...\n\nWords";
  const view = editor(source);
  expect(editorBlockTarget(view.state, 6)).toBeUndefined();
  expect(
    editorBlockTarget(view.state, source.indexOf("Words"))!.block.kind,
  ).toBe("paragraph");
  const empty = editor("");
  expect(editorBlockTarget(empty.state, 0)!.index).toBe(-1);
  expect(
    insertEditorBlockAt(empty, editorBlockTarget(empty.state, 0)!, "heading1")
      .kind,
  ).toBe("insert");
  expect(empty.state.doc.toString()).toBe("# ");
});
it("moves complete fenced source as one edit and restores it exactly on undo", () => {
  const source = "First\n\n~~~rust\n# literal\n~~~\n\nLast";
  const view = editor(source);
  const target = editorBlockTarget(view.state, source.indexOf("literal"))!;
  expect(moveEditorBlock(view, target, 0)).toBe(true);
  const expected = "~~~rust\n# literal\n~~~\n\nFirst\n\nLast";
  expect(view.state.doc.toString()).toBe(expected);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(source);
  expect(redo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(expected);
});
it("inserts after the target without a temporary slash or changing existing words", () => {
  const source = "First\n\nLast";
  const view = editor(source);
  const target = editorBlockTarget(view.state, 2)!;
  const plan = insertEditorBlockAt(view, target, "quote");
  expect(plan.kind).toBe("insert");
  expect(view.state.doc.toString()).toBe("First\n\n> \n\nLast");
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(source);
});
it("refuses stale, read-only and composing requests without changing source", () => {
  const view = editor("A\n\nB");
  const target = editorBlockTarget(view.state, 3)!;
  view.dispatch({ changes: { from: 4, insert: " kept" } });
  expect(moveEditorBlock(view, target, 0)).toBe(false);
  expect(insertEditorBlockAt(view, target, "quote").kind).toBe("unavailable");
  expect(view.state.doc.toString()).toBe("A\n\nB kept");
  const current = editorBlockTarget(view.state, 3)!;
  Object.defineProperty(view, "compositionStarted", {
    configurable: true,
    value: true,
  });
  expect(moveEditorBlock(view, current, 0)).toBe(false);
  Object.defineProperty(view, "compositionStarted", { value: false });
  view.dispatch({
    effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)),
  });
  expect(editorBlockTarget(view.state, 3)).toBeUndefined();
  expect(moveEditorBlock(view, current, 0)).toBe(false);
});

it("inserts inline catalog entries as separate blocks after a closed fence", () => {
  const source = "~~~js\nkeep();\n~~~\n\nLast";
  const view = editor(source);
  const target = editorBlockTarget(view.state, 1)!;
  expect(
    insertEditorBlockAt(view, target, "date", { date: "2026-11-18" }).kind,
  ).toBe("insert");
  expect(view.state.doc.toString()).toBe(
    "~~~js\nkeep();\n~~~\n\n2026-11-18\n\nLast",
  );
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe(source);
});
