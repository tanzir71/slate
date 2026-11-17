import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { expect, it, vi } from "vitest";
import { MarkdownEditor } from "../src/MarkdownEditor";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("displays external values without autosave echoes, caret jumps or undoing external words", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const changed = vi.fn();
  try {
    await act(async () => { root.render(createElement(MarkdownEditor, { value: "Alpha\nBeta", onChange: changed })); });
    const view = EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-content")!);
    if (!view) throw new Error("Editor did not mount");
    view.dispatch({ selection: { anchor: 3 } });
    await act(async () => { root.render(createElement(MarkdownEditor, { value: "Alpha\nBeta\nGamma", onChange: changed })); });
    expect(view.state.doc.toString()).toBe("Alpha\nBeta\nGamma");
    expect(changed).not.toHaveBeenCalled();
    expect(view.state.selection.main.head).toBe(3);
    const undo = () => runScopeHandlers(view, new KeyboardEvent("keydown", { key: "z", ctrlKey: !/Mac/.test(navigator.platform), metaKey: /Mac/.test(navigator.platform) }), "editor");
    undo();
    expect(view.state.doc.toString()).toBe("Alpha\nBeta\nGamma");
    view.dispatch({ changes: { from: 0, insert: "typed " } });
    expect(changed).toHaveBeenLastCalledWith("typed Alpha\nBeta\nGamma");
    undo();
    expect(view.state.doc.toString()).toBe("Alpha\nBeta\nGamma");
    expect(changed).toHaveBeenLastCalledWith("Alpha\nBeta\nGamma");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("opens a shortened CRLF file with an out-of-range remembered caret without writing it back", async () => {
  const key = "slate.editor.shortened";
  localStorage.setItem(key, JSON.stringify({ anchor: 1000, scroll: 0 }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const changed = vi.fn();
  try {
    await act(async () => { root.render(createElement(MarkdownEditor, { value: "a\r\nb\r\n", documentKey: "shortened", onChange: changed })); });
    const view = EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-content")!);
    expect(view?.state.doc.toString()).toBe("a\nb\n");
    expect(view?.state.selection.main.head).toBe(4);
    expect(changed).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    localStorage.removeItem(key);
  }
});
