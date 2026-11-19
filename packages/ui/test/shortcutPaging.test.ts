import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { readKeymap } from "../src/commands";
import { CommandDialog } from "../src/browser/CommandDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("pages the focused shortcut region, clamps its ends and leaves modified/input keys alone", async () => {
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host);
  const modal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
  const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: () => undefined });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: () => undefined });
  try {
    await act(async () => root.render(createElement(CommandDialog, { kind: "shortcuts", keymap: readKeymap(undefined, "windows"), os: "windows", editor: true, selection: false, onClose: vi.fn(), onCommand: vi.fn() })));
    const region = host.querySelector<HTMLElement>('[aria-label="Keyboard shortcut list"]')!;
    Object.defineProperties(region, { clientHeight: { value: 200 }, scrollHeight: { value: 1000 } }); region.focus();
    const key = (name: string, options: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...options }); region.dispatchEvent(event); return event;
    };
    expect(key("PageDown").defaultPrevented).toBe(true); expect(region.scrollTop).toBeGreaterThan(0);
    key("End"); expect(region.scrollTop).toBe(800);
    key("PageDown"); expect(region.scrollTop).toBe(800);
    key("PageUp"); expect(region.scrollTop).toBeLessThan(800);
    key("Home"); expect(region.scrollTop).toBe(0);
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { isComposing: true }]) expect(key("PageDown", options).defaultPrevented).toBe(false);
    expect(region.scrollTop).toBe(0); expect(key("a").defaultPrevented).toBe(false);
  } finally {
    await act(async () => root.unmount()); host.remove();
    if (modal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", modal); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    if (close) Object.defineProperty(HTMLDialogElement.prototype, "close", close); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  }
});
