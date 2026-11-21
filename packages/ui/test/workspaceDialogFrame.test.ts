import { act, createElement, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { WorkspaceDialog } from "../src/browser/WorkspaceDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const descriptors = new Map([
  ["showModal", Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal")],
  ["close", Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close")],
]);
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterAll(() => {
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

it("opens the native modal and focuses its field before surrounding layout reads, then returns focus on close", async () => {
  const invoker = document.createElement("button"), host = document.createElement("div");
  document.body.append(invoker, host); invoker.focus();
  const root = createRoot(host);
  let layout: { open: boolean; focused: boolean } | undefined;
  function Probe() {
    const input = useRef<HTMLInputElement>(null);
    useLayoutEffect(() => { layout = { open: host.querySelector("dialog")!.open, focused: document.activeElement === input.current }; }, []);
    return createElement(WorkspaceDialog, { title: "Find a sheet", initialFocus: input, returnFocus: invoker, onClose() {},
      children: createElement("input", { ref: input, "aria-label": "Find a sheet" }) });
  }
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(layout).toEqual({ open: true, focused: true });
  } finally {
    await act(async () => root.unmount());
    expect(document.activeElement).toBe(invoker);
    host.remove(); invoker.remove();
  }
});

it("restores the editor selection when native modal close already returned DOM focus", async () => {
  const editorHost = document.body.appendChild(document.createElement("div"));
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host);
  const view = new EditorView({ parent: editorHost, state: EditorState.create({ doc: "my words", selection: { anchor: 3 } }) });
  const close = vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    // Native dialog focus restoration and the editor's DOM selection can settle
    // separately. Calling HTMLElement.focus again emits no focus event here.
    view.contentDOM.focus();
    document.getSelection()!.removeAllRanges();
  });
  try {
    view.focus();
    await act(async () => root.render(createElement(WorkspaceDialog, {
      title: "Search everywhere", returnFocus: view.contentDOM, restoreFocus: () => view.focus(), onClose() {},
      children: createElement("input", { "aria-label": "Search" }),
    })));
    await act(async () => root.unmount());
    expect(document.activeElement).toBe(view.contentDOM);
    const selection = document.getSelection()!;
    expect(selection.rangeCount).toBe(1);
    expect(view.contentDOM.contains(selection.anchorNode)).toBe(true);
    expect(view.posAtDOM(selection.anchorNode!, selection.anchorOffset)).toBe(3);
    expect(view.state.doc.toString()).toBe("my words");
  } finally {
    close.mockRestore(); view.destroy(); editorHost.remove(); host.remove();
  }
});

it("does not return focus to a widget removed while the dialog was open", async () => {
  const invoker = document.body.appendChild(document.createElement("button"));
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host);
  const restoreFocus = vi.fn();
  invoker.focus();
  await act(async () => root.render(createElement(WorkspaceDialog, {
    title: "Search everywhere", returnFocus: invoker, restoreFocus, onClose() {}, children: createElement("input"),
  })));
  invoker.remove();
  await act(async () => root.unmount());
  expect(restoreFocus).not.toHaveBeenCalled();
  host.remove();
});
