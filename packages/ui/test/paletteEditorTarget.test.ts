import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { MarkdownEditor } from "../src/MarkdownEditor";
import type { MarkdownEditorHandle } from "../src/commands";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createFileSpace } from "@slate/storage/file-space";
import { createBlockLibrary } from "../src/blocks/blockLibrary";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const rectangles = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
const bounds = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
let host: HTMLDivElement, root: Root | undefined, handle: MarkdownEditorHandle | undefined;
beforeAll(() => {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
});
afterAll(() => {
  if (rectangles) Object.defineProperty(Range.prototype, "getClientRects", rectangles); else Reflect.deleteProperty(Range.prototype, "getClientRects");
  if (bounds) Object.defineProperty(Range.prototype, "getBoundingClientRect", bounds); else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
});
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; host?.remove(); handle = undefined; localStorage.clear(); });
async function mount(value: string, extra: Partial<Parameters<typeof MarkdownEditor>[0]> = {}) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const changed = vi.fn();
  await act(async () => root?.render(createElement(MarkdownEditor, {
    value, initialCursor: value.startsWith("\uFEFF") ? 1 : 0, onChange: changed, onHandle: (next) => { handle = next; }, ...extra,
  })));
  return { changed, view: EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-content")!)! };
}
it("guards outline moves by file scope, current source, editability and composition", async () => {
  const source = "# Alpha\nA\n\n# Beta\nB\n";
  const onChange = vi.fn(), onHandle = (next: MarkdownEditorHandle | undefined) => { handle = next; };
  const { view } = await mount(source, { documentKey: "first", onChange, onHandle });
  expect(handle!.sectionTarget(source + "stale")).toBeUndefined();
  const target = handle!.sectionTarget(source)!;
  expect(target.move(0, 1)).toBe(false);
  expect(target.move(-1, 0)).toBe(false); expect(target.move(0, 99)).toBe(false);
  Object.defineProperty(view, "compositionStarted", { configurable: true, value: true });
  expect(target.move(1, 0)).toBe(false);
  Object.defineProperty(view, "compositionStarted", { value: false });
  await act(async () => root?.render(createElement(MarkdownEditor, { value: source, documentKey: "second", onChange, onHandle })));
  expect(target.move(1, 0)).toBe(false);
  const other = handle!.sectionTarget(source)!;
  await act(async () => root?.render(createElement(MarkdownEditor, { value: source, documentKey: "second", readOnly: true, onChange, onHandle })));
  expect(other.move(1, 0)).toBe(false); expect(handle!.sectionTarget(source)).toBeUndefined();
  expect(handle!.source()).toBe(source); expect(onChange).not.toHaveBeenCalled();
});
it("starts a block insertion from the captured editor with one undo and exact BOM/CRLF originals", async () => {
  const source = "\uFEFFWords kept.\r\n";
  const { view } = await mount(source);
  const target = handle!.creationTarget()!;
  expect(target.matches()).toBe(true);
  await act(async () => { expect(target.block("heading2")).toBe(true); });
  expect(handle!.source()).toMatch(/^\uFEFFWords kept\.\r\n\r\n## /);
  await act(async () => { expect(runScopeHandlers(view, new KeyboardEvent("keydown", { key: "z", ctrlKey: !/Mac/.test(navigator.platform), metaKey: /Mac/.test(navigator.platform) }), "editor")).toBe(true); });
  expect(handle!.source()).toBe(source);
});
it("rejects newer words, changed selections and lost write ownership without changing source", async () => {
  let owned = true;
  const { view } = await mount("Words kept.", { canInsertBlock: () => owned });
  const selectionTarget = handle!.creationTarget()!;
  await act(async () => view.dispatch({ selection: { anchor: 2 } }));
  expect(selectionTarget.matches()).toBe(false); expect(selectionTarget.block("heading2")).toBe(false);
  const sourceTarget = handle!.creationTarget()!;
  await act(async () => view.dispatch({ changes: { from: 0, insert: "New " } }));
  expect(sourceTarget.matches()).toBe(false); expect(sourceTarget.snippet()).toBeUndefined();
  const ownedTarget = handle!.creationTarget()!; owned = false;
  expect(ownedTarget.matches()).toBe(false); expect(ownedTarget.block("heading2")).toBe(false);
  expect(handle!.source()).toBe("New Words kept.");
});
it("inserts the existing EOF heading recipe after a selected block while keeping all original bytes", async () => {
  const source = "\uFEFF# Same\r\n\r\nAlpha words.\r\n\r\n## First goal\r\n";
  const { view } = await mount(source);
  await act(async () => view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }));
  await act(async () => { expect(handle!.creationTarget()!.block("heading2")).toBe(true); });
  expect(handle!.source()).toBe(source + "\r\n## ");
  await act(async () => { expect(runScopeHandlers(view, new KeyboardEvent("keydown", { key: "z", ctrlKey: !/Mac/.test(navigator.platform), metaKey: /Mac/.test(navigator.platform) }), "editor")).toBe(true); });
  expect(handle!.source()).toBe(source);
});
it("cannot use a captured target after switching to another editor with identical source", async () => {
  await mount("Words kept."); const target = handle!.creationTarget()!;
  await act(async () => root?.render(createElement(MarkdownEditor, {
    key: "another-file", value: "Words kept.", onChange: vi.fn(), onHandle: (next) => { handle = next; },
  })));
  expect(target.matches()).toBe(false); expect(target.block("heading2")).toBe(false); expect(target.snippet()).toBeUndefined();
  expect(handle!.source()).toBe("Words kept.");
});
it("invalidates a same-view target when its document scope or ownership callback changes", async () => {
  const onChange = vi.fn(), onHandle = (next: MarkdownEditorHandle | undefined) => { handle = next; };
  await mount("Words kept.", { documentKey: "first", onChange, onHandle });
  const target = handle!.creationTarget()!;
  await act(async () => root?.render(createElement(MarkdownEditor, { value: "Words kept.", documentKey: "second", onChange, onHandle })));
  expect(handle!.documentKey()).toBe("second"); expect(target.matches()).toBe(false);
  const owned = handle!.creationTarget()!;
  await act(async () => root?.render(createElement(MarkdownEditor, { value: "Words kept.", documentKey: "second", canInsertBlock: () => false, onChange, onHandle })));
  expect(owned.matches()).toBe(false); expect(owned.block("heading2")).toBe(false);
  expect(handle!.source()).toBe("Words kept."); expect(onChange).not.toHaveBeenCalled();
});
it("refuses a custom block whose source changed after the palette captured its preview", async () => {
  const path = ".slate/blocks/fragment.md", source = "---\nname: My fragment\n---\nOriginal fragment words.\n";
  const files = createMemoryFiles({ [path]: source }); const library = createBlockLibrary(createFileSpace(files), () => true);
  try {
    await library.refresh(); const block = library.getSnapshot().blocks[0]!;
    await mount("Words kept.", { customBlockLibrary: library }); const target = handle!.creationTarget()!;
    await files.write(path, encodeText(source.replace("Original", "Changed")));
    await act(async () => library.refresh());
    expect(target.matches()).toBe(true); expect(target.block(block.id, block.source)).toBe(false);
    expect(handle!.source()).toBe("Words kept.");
  } finally { library.dispose(); }
});
it("navigates exact raw-source offsets in a read-only BOM/CRLF file without emitting a save", async () => {
  const source = "\uFEFFFirst\r\n\r\n## বাংলা\r\n";
  const { changed, view } = await mount(source, { readOnly: true });
  expect(handle!.creationTarget()).toBeUndefined();
  await act(async () => { expect(handle!.goToSourceOffset(source, source.indexOf("##"))).toBe(true); });
  expect(view.state.selection.main.head).toBe(source.slice(0, source.indexOf("##")).replace(/\r\n?/g, "\n").length);
  expect(changed).not.toHaveBeenCalled(); expect(handle!.source()).toBe(source);
});
it("refuses stale text or invalid raw offsets instead of moving the selection", async () => {
  const source = "Words kept."; const { view, changed } = await mount(source);
  for (const offset of [-1, NaN, Infinity, source.length + 1]) expect(handle!.goToSourceOffset(source, offset)).toBe(false);
  expect(handle!.goToSourceOffset("Different", 1)).toBe(false);
  expect(view.state.selection.main.head).toBe(0); expect(changed).not.toHaveBeenCalled();
});
