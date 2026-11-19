import { act, createElement, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, expect, it } from "vitest";
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
