import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorState, StateEffect, Transaction } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { createDocumentSession, editorSource, enterEditorFence, chooseEditorFenceLanguage, type DocumentSession, type EditorFenceRequest } from "@slate/editor";
import { fix, readTidyConfiguration } from "@slate/core/tidy";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MarkdownEditor } from "../src/MarkdownEditor";
import type { MarkdownEditorHandle } from "../src/commands";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";
import { createEditorDocumentPool } from "../src/browser/editorDocumentPool";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const original = "\uFEFF# Alpha\r\n\r\nWords kept.\r\n";
const normalize = (value: string) => value.replace(/\r\n?/g, "\n");
const roots: { root: Root; host: HTMLDivElement; detach(): void }[] = [];
const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
const rangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
beforeEach(() => {
  localStorage.clear();
  // jsdom has no text layout; actual pane layout/keyboard acceptance belongs in Playwright.
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
});
afterEach(async () => {
  for (const mounted of roots.splice(0)) { await act(async () => mounted.root.unmount()); mounted.detach(); mounted.host.remove(); }
  if (rangeRects) Object.defineProperty(Range.prototype, "getClientRects", rangeRects); else Reflect.deleteProperty(Range.prototype, "getClientRects");
  if (rangeBounds) Object.defineProperty(Range.prototype, "getBoundingClientRect", rangeBounds); else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  localStorage.clear();
});
async function mount(session: DocumentSession, panes: readonly ("left" | "right")[] = ["left", "right"]) {
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host);
  const changed = vi.fn(), handles = new Map<string, MarkdownEditorHandle>();
  const detach = session.subscribe((update) => { if (update.kind !== "external") changed(update.source, update.kind, update.userEvent); });
  roots.push({ root, host, detach });
  async function render(next: readonly ("left" | "right")[]) {
    await act(async () => root.render(createElement("div", {}, next.map((pane) => createElement("section", { key: pane, "data-pane": pane },
      createElement(MarkdownEditor, { documentSession: session, documentKey: "shared-test/note.md", viewKey: `shared-test/${pane}/note.md`,
        ...(pane === "right" ? { initialCursor: session.snapshot().source.length } : {}),
        onHandle(handle) { if (handle) handles.set(pane, handle); else handles.delete(pane); },
      }))))));
  }
  await render(panes);
  const view = (pane: "left" | "right") => EditorView.findFromDOM(host.querySelector<HTMLElement>(`[data-pane="${pane}"] .cm-content`)!)!;
  return { render, view, changed, handles };
}
async function type(view: EditorView, from: number, text: string) {
  await act(async () => view.dispatch({ changes: { from, insert: text }, selection: { anchor: from + text.length },
    annotations: Transaction.userEvent.of("input.type") }));
}
async function historyKey(view: EditorView, redo = false) {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const event = new KeyboardEvent("keydown", { key: redo && !mac ? "y" : "z", ctrlKey: !mac, metaKey: mac, shiftKey: redo && mac });
  await act(async () => { expect(runScopeHandlers(view, event, "editor")).toBe(true); });
}

it("mounts two actual editor views with exact physical source", async () => {
  const session = createDocumentSession(original), { view, changed } = await mount(session);
  for (const pane of ["left", "right"] as const) {
    expect(editorSource(view(pane).state)).toBe(original);
  }
  expect(changed).not.toHaveBeenCalled();
});

it("saves real peer edits and shared Undo once to the nonselected file", async () => {
  const files = createMemoryFiles({ "a.md": original, "b.md": "Beta\n" });
  const store = createWorkspaceStore({ id: "sample", name: "Notes", tier: "library" }, files); await store.load();
  const pool = createEditorDocumentPool(store); pool.connect();
  try {
    await store.select("b.md"); const session = pool.get("a.md", createDocumentSession)!;
    const { view } = await mount(session), changed = vi.spyOn(store, "editSheet");
    await type(view("left"), view("left").state.doc.length, "One save");
    expect(editorSource(view("right").state)).toBe(original + "One save");
    expect(changed).toHaveBeenCalledTimes(1); await store.flush();
    expect(await files.read("a.md")).toEqual(encodeText(original + "One save"));
    await historyKey(view("right")); expect(changed).toHaveBeenCalledTimes(2); await store.flush();
    expect(await files.read("a.md")).toEqual(encodeText(original));
    expect(await files.read("b.md")).toEqual(encodeText("Beta\n"));
    expect(store.api.getState().selectedPath).toBe("b.md");
  } finally { pool.dispose(); }
});

it("propagates actual view edits once and maps the other pane's independent cursor", async () => {
  const session = createDocumentSession(original), { view, changed } = await mount(session);
  const left = view("left"), right = view("right"), from = normalize(original).indexOf("Alpha") + 5;
  await type(left, from, "!"); const first = original.replace("Alpha", "Alpha!");
  expect(editorSource(left.state)).toBe(first); expect(editorSource(right.state)).toBe(first);
  expect(right.state.selection.main.head).toBe(normalize(first).length);
  expect(changed).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenLastCalledWith(first, "edit", "input.type");
  await type(right, right.state.doc.length, "Beta");
  expect(editorSource(left.state)).toBe(first + "Beta"); expect(editorSource(right.state)).toBe(first + "Beta");
  expect(left.state.selection.main.head).toBe(from + 1); expect(changed).toHaveBeenCalledTimes(2);
  await historyKey(right); expect(session.snapshot().source).toBe(first);
  await historyKey(left); expect(session.snapshot().source).toBe(original);
  await historyKey(right, true); await historyKey(left, true);
  expect(editorSource(left.state)).toBe(first + "Beta"); expect(editorSource(right.state)).toBe(first + "Beta");
  expect(changed).toHaveBeenCalledTimes(6);
});

it.each(["z", "Z"])("restores shared Undo with a shifted %s redo key", async (key) => {
  const session = createDocumentSession(original), { view } = await mount(session);
  await type(view("left"), view("left").state.doc.length, "Redo these words"); await historyKey(view("right"));
  const mac = /Mac|iPhone|iPad/.test(navigator.platform), event = new KeyboardEvent("keydown", { key, ctrlKey: !mac, metaKey: mac, shiftKey: true });
  await act(async () => { expect(runScopeHandlers(view("left"), event, "editor")).toBe(true); });
  expect(session.snapshot().source).toBe(original + "Redo these words"); expect(editorSource(view("right").state)).toBe(original + "Redo these words");
});

it.each(["", "\uFEFF# Header\r\n\r\n"])("amends a fence language as one shared history/save update with prefix %j", async (prefix) => {
  const fence = String.fromCharCode(96).repeat(3), source = prefix + fence, session = createDocumentSession(source), { view, changed } = await mount(session);
  const left = view("left"), right = view("right"); let request: EditorFenceRequest | undefined;
  await act(async () => {
    left.dispatch({ selection: { anchor: left.state.doc.length } });
    expect(enterEditorFence(left, { onPickLanguage(_view, input) { request = input; } })).toBe(true);
  });
  expect(request).toBeDefined();
  await act(async () => { expect(chooseEditorFenceLanguage(left, request!, "json")).toBe(true); });
  const ending = prefix ? "\r\n" : "\n", chosen = prefix + fence + "json" + ending.repeat(2) + fence;
  expect(session.snapshot().source).toBe(chosen); expect(editorSource(right.state)).toBe(chosen); expect(changed).toHaveBeenCalledTimes(2);
  expect(changed).toHaveBeenLastCalledWith(chosen, "amend", "input.fence");
  await historyKey(right); expect(editorSource(left.state)).toBe(source);
  await historyKey(left, true); expect(editorSource(right.state)).toBe(chosen); expect(changed).toHaveBeenCalledTimes(4);
});

it("preserves Tidy's raw bytes and action origin when Undo comes from the other pane", async () => {
  const source = "\uFEFF#   Draft\r\n", session = createDocumentSession(source), { view, changed, handles } = await mount(session);
  const result = fix(source, readTidyConfiguration());
  await act(async () => { expect(handles.get("left")!.applyTidy(result)).toBe(true); });
  expect(session.snapshot().source).toBe(result.output); expect(editorSource(view("right").state)).toBe(result.output);
  expect(changed).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenLastCalledWith(result.output, "edit", "input.tidy");
  await historyKey(view("right"));
  expect(editorSource(view("left").state)).toBe(source); expect(editorSource(view("right").state)).toBe(source);
  expect(changed).toHaveBeenLastCalledWith(source, "undo", "undo");
});

it("retains file Undo after unmounting both views and opening the file again", async () => {
  const session = createDocumentSession(original), mounted = await mount(session, ["left"]);
  await type(mounted.view("left"), 0, "!"); await mounted.render([]); await mounted.render(["right"]);
  expect(editorSource(mounted.view("right").state)).toBe("!" + original);
  await historyKey(mounted.view("right")); expect(editorSource(mounted.view("right").state)).toBe(original);
  expect(mounted.changed).toHaveBeenCalledTimes(2);
});

it("retains the physical newline preference even when a tab temporarily contains no newline", async () => {
  const session = createDocumentSession("A\r\nB"), mounted = await mount(session, ["left"]);
  await act(async () => mounted.view("left").dispatch({ changes: { from: 1, to: 2 }, annotations: Transaction.userEvent.of("input.delete") }));
  expect(session.snapshot().source).toBe("AB"); await mounted.render([]); await mounted.render(["left"]);
  await type(mounted.view("left"), 1, "\n");
  expect(editorSource(mounted.view("left").state)).toBe("A\r\nB");
  expect(session.snapshot().source).toBe("A\r\nB"); expect(editorSource(session.snapshot().state)).toBe("A\r\nB");
});

it("displays authoritative external bytes in both panes without echo saves or obsolete Undo", async () => {
  const session = createDocumentSession(original), { view, changed } = await mount(session);
  await type(view("left"), 0, "!"); const writes = changed.mock.calls.length;
  const external = "\uFEFF# External\r\n\r\nNewer words.\r\n";
  await act(async () => { session.replaceSource(external); });
  expect(editorSource(view("left").state)).toBe(external); expect(editorSource(view("right").state)).toBe(external);
  expect(changed).toHaveBeenCalledTimes(writes); await historyKey(view("right"));
  expect(session.snapshot().source).toBe(external); expect(changed).toHaveBeenCalledTimes(writes);
});

it("blocks live permission loss before a still-editable view can mutate its document", async () => {
  let owned = true;
  const session = createDocumentSession(original, () => owned), { view, changed } = await mount(session);
  owned = false; await type(view("left"), 0, "Must not edit");
  expect(editorSource(view("left").state)).toBe(original); expect(editorSource(view("right").state)).toBe(original);
  expect(session.snapshot().source).toBe(original); expect(changed).not.toHaveBeenCalled();
  owned = true; await type(view("left"), 0, "Allowed ");
  expect(editorSource(view("right").state)).toBe("Allowed " + original); expect(changed).toHaveBeenCalledTimes(1);
});

it("runs a view's input transformation only on its own edits, then broadcasts the resulting source once", async () => {
  const session = createDocumentSession(original), { view, changed } = await mount(session);
  const left = view("left"), right = view("right");
  await act(async () => left.dispatch({ effects: StateEffect.appendConfig.of(EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged || transaction.newDoc.sliceString(Math.max(0, transaction.newDoc.length - 4)) !== "Beta") return transaction;
    return [transaction, { changes: { from: transaction.newDoc.length, insert: " local" }, sequential: true }];
  })) }));
  await type(right, right.state.doc.length, "Beta");
  expect(editorSource(left.state)).toBe(original + "Beta"); expect(editorSource(right.state)).toBe(original + "Beta");
  expect(changed).toHaveBeenCalledTimes(1);
  await type(left, left.state.doc.length, "Beta");
  expect(session.snapshot().source).toBe(original + "BetaBeta local");
  expect(editorSource(left.state)).toBe(session.snapshot().source); expect(editorSource(right.state)).toBe(session.snapshot().source);
  expect(changed).toHaveBeenCalledTimes(2);
});
