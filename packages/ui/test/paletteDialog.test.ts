import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import type { PaletteEntry } from "@slate/core";
import { PaletteDialog } from "../src/browser/PaletteDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const descriptors = new Map([
  ["showModal", Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal")],
  ["close", Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close")],
]);
const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
let host: HTMLDivElement, root: Root | undefined;
const entries: PaletteEntry[] = [
  { id: "tidy.document", kind: "commands", label: "Tidy document", detail: "Review this sheet" },
  { id: "tidy.batch", kind: "commands", label: "Batch Tidy", detail: "Review this Space" },
  { id: "Work/Plan.md", kind: "sheets", label: "Plan", detail: "Work" },
  { id: "Home/Plan.md", kind: "sheets", label: "Plan", detail: "Home" },
  { id: "draft", kind: "tags", label: "#draft" },
  { id: "Plan.md:10", kind: "headings", label: "Goals" },
  { id: "table", kind: "blocks", label: "Table" },
  { id: "signature", kind: "snippets", label: "Signature" },
];
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
});
afterAll(() => {
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
  if (scroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; host?.remove(); });
async function mount(props: Partial<Parameters<typeof PaletteDialog>[0]> = {}) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const onChoose = vi.fn(async () => undefined), onClose = vi.fn();
  await act(async () => root?.render(createElement(PaletteDialog, { entries, onChoose, onClose, ...props })));
  return { onChoose, onClose };
}
const input = () => host.querySelector<HTMLInputElement>("input")!;
async function query(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(value: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...options });
  await act(async () => { input().dispatchEvent(event); }); return event;
}

it("chooses the highlighted command once and blocks cancellation while its action is pending", async () => {
  let finish: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const onChoose = vi.fn(() => pending), onClose = vi.fn();
  await mount({ onChoose, onClose }); await query("tidy");
  await key("ArrowDown"); await key("Enter"); await key("Enter");
  expect(onChoose).toHaveBeenCalledTimes(1);
  expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: "tidy.batch" }), false);
  expect(input().disabled).toBe(true);
  await act(async () => { host.querySelector("dialog")!.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })); });
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { finish(); await pending; });
  expect(onClose).toHaveBeenCalledTimes(1);
});
it("switches all prefix modes and keeps composition confirmation separate from running an action", async () => {
  const { onChoose } = await mount();
  for (const [text, label] of [["#draft", "#draft"], ["@Goals", "Goals"], ["/table", "Table"], [";signature", "Signature"]]) {
    await query(text!);
    expect([...host.querySelectorAll(".commandResults button")].map((button) => button.getAttribute("aria-label"))).toEqual([label]);
  }
  await key("Enter", { isComposing: true }); expect(onChoose).not.toHaveBeenCalled();
  await key("Enter"); expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: "signature" }), false);
});
it("does not execute an unavailable creation row from either Enter or a click", async () => {
  const { onChoose, onClose } = await mount({ available: (entry) => entry.kind !== "blocks" });
  await query("/table"); const button = host.querySelector<HTMLButtonElement>('.commandResults button[aria-label="Table"]')!;
  expect(button.disabled).toBe(true); await key("Enter"); await act(async () => button.click());
  expect(onChoose).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled(); expect(input().disabled).toBe(false);
});
it("gives identical sheet titles their distinct accessible path descriptions and uses the Mac split key", async () => {
  await mount({ initialMode: "sheets", allowSplit: true, os: "mac" });
  const choices = [...host.querySelectorAll<HTMLButtonElement>('.commandResults button[aria-label="Plan"]')];
  expect(choices).toHaveLength(2);
  expect(choices.map((button) => document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent).sort()).toEqual(["Home", "Work"]);
  expect(host.querySelector("footer")?.textContent).toContain("⌘");
});
it("opens the selected preview with Tab and allows the following Tab to move focus normally", async () => {
  await mount({ preview: (entry) => createElement("pre", null, `Preview ${entry.label}`) });
  expect(document.activeElement).toBe(input());
  expect((await key("Tab")).defaultPrevented).toBe(true);
  expect(host.querySelector('[aria-label="Result preview"]')?.textContent).toContain("Tidy document");
  expect((await key("Tab")).defaultPrevented).toBe(false);
});
it("keeps a failed navigation's search and restores its focus for another choice", async () => {
  let reject: (cause: Error) => void = () => undefined;
  const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
  const onClose = vi.fn();
  await mount({ onChoose: () => pending, onClose }); await query("tidy"); await key("Enter");
  input().blur(); // Real disabled controls lose focus; jsdom does not perform that browser step.
  const pendingDialog = host.querySelector("dialog")!; pendingDialog.tabIndex = -1; pendingDialog.focus();
  expect(document.activeElement).toBe(pendingDialog);
  await act(async () => { reject(new Error("This sheet no longer exists.")); await pending.catch(() => undefined); });
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("This sheet no longer exists.");
  expect(input().value).toBe("tidy"); expect(input().disabled).toBe(false); expect(document.activeElement).toBe(input());
  expect(onClose).not.toHaveBeenCalled();
});
it("restores its invoker on cancellation and renders untrusted labels as plain text", async () => {
  const invoker = document.createElement("button"); invoker.textContent = "Open"; document.body.append(invoker); invoker.focus();
  const { onClose } = await mount({ initialMode: "sheets", entries: [{ id: "one", kind: "sheets", label: "<script>Words</script>" }] });
  expect(host.querySelector("script")).toBeNull();
  expect(host.textContent).toContain("<script>Words</script>");
  await act(async () => { host.querySelector("dialog")!.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })); });
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => root?.unmount()); root = undefined;
  expect(document.activeElement).toBe(invoker); invoker.remove();
});
