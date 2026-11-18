import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { SlateApp } from "../src/SlateApp";
import { desktopPreviewCommands } from "../src/desktopCommands";
import { spaces } from "../src/sampleData";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
const rangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");

beforeAll(() => {
  // jsdom has no layout; real geometry remains covered by the browser toolbar tests.
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterAll(() => {
  if (rangeRects) Object.defineProperty(Range.prototype, "getClientRects", rangeRects);
  else Reflect.deleteProperty(Range.prototype, "getClientRects");
  if (rangeBounds) Object.defineProperty(Range.prototype, "getBoundingClientRect", rangeBounds);
  else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  if (showModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", showModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (close) Object.defineProperty(HTMLDialogElement.prototype, "close", close);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  localStorage.clear();
});

async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(SlateApp, { autosaveWriter: { writeSheet: vi.fn(async (path: string) => ({ status: "written" as const, path })) } })));
}
function view() { return EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-content")!)!; }
async function key(key: string, options: KeyboardEventInit = {}, target: EventTarget = window) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}
const mod = () => /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };

it("starts without a palette or inspector and reserves Mod I for formatting", async () => {
  await mount();
  expect(host.querySelector("dialog")).toBeNull();
  expect(host.querySelector(".slateApp")?.classList.contains("inspectorHidden")).toBe(true);
  const editor = view();
  await act(async () => {
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "Words" }, selection: { anchor: 0, head: 5 } });
    editor.focus();
  });
  await key("i", mod(), editor.contentDOM);
  expect(editor.state.doc.toString()).toBe("*Words*");
  expect(host.querySelector(".slateApp")?.classList.contains("inspectorHidden")).toBe(true);
  await key("i", { ...mod(), shiftKey: true, code: "KeyI" }, editor.contentDOM);
  expect(host.querySelector(".slateApp")?.classList.contains("inspectorHidden")).toBe(false);
});

it("uses the desktop registry for labels, available actions and modal focus", async () => {
  await mount();
  const button = [...host.querySelectorAll("button")].find((button) => button.textContent === "Keyboard shortcuts")!;
  button.focus();
  await act(async () => button.click());
  const dialog = host.querySelector<HTMLDialogElement>("dialog")!;
  expect(dialog.open).toBe(true);
  expect(dialog.textContent).toContain("Desktop");
  expect(dialog.textContent).not.toContain("Export Space");
  expect(dialog.querySelectorAll(".shortcutRow")).toHaveLength(desktopPreviewCommands(spaces.length).length);
  const row = [...dialog.querySelectorAll(".shortcutRow")].find((row) => row.textContent?.startsWith("New sheet"))!;
  expect(row.textContent).toContain(/Mac/.test(navigator.platform) ? "⌘ N" : "Ctrl N");
  expect(document.activeElement).toBe(dialog.querySelector("input"));
  await act(async () => dialog.dispatchEvent(new Event("cancel", { cancelable: true })));
  expect(host.querySelector("dialog")).toBeNull();
  expect(document.activeElement).toBe(button);
});

it("ignores handled and composing keys and retains mode and Space commands", async () => {
  await mount();
  const handled = new KeyboardEvent("keydown", { key: "I", ...mod(), shiftKey: true, cancelable: true });
  handled.preventDefault();
  await act(async () => window.dispatchEvent(handled));
  await key("I", { ...mod(), shiftKey: true, isComposing: true });
  expect(host.querySelector(".slateApp")?.classList.contains("inspectorHidden")).toBe(true);
  await key(".", mod());
  expect(host.querySelector(".slateApp")?.classList.contains("focusMode")).toBe(true);
  await key("F11");
  expect(host.querySelector(".slateApp")?.classList.contains("fullscreenMode")).toBe(true);
  await key("Escape");
  expect(host.querySelector(".slateApp")?.classList.contains("fullscreenMode")).toBe(false);
  expect(host.querySelector(".slateApp")?.classList.contains("focusMode")).toBe(false);
  await key("2", { ...mod(), altKey: true });
  expect(host.querySelector('.spaceList [aria-current="true"]')?.textContent).toBe("Blog");
});

it("creates a new sheet with Mod N and keeps each sheet's undo history separate", async () => {
  await mount();
  const previous = view();
  await act(async () => previous.dispatch({ changes: { from: 0, to: previous.state.doc.length, insert: "Previous words" } }));
  expect((await key("n", mod())).defaultPrevented).toBe(true);
  const next = view();
  expect(next).not.toBe(previous);
  const content = next.state.doc.toString();
  await key("z", mod(), next.contentDOM);
  expect(next.state.doc.toString()).toBe(content);
  expect(host.querySelector('.sheetRow.active .sheetTitleLine')?.textContent).toBe("Untitled Sheet");
});

it("opens editor settings from the desktop command and remembers disabled smart input", async () => {
  await mount();
  expect(desktopPreviewCommands(spaces.length).some((command) => command.id === "app.editorSettings")).toBe(true);
  expect(desktopPreviewCommands(spaces.length).filter((command) => command.group === "Table")).toHaveLength(8);
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Editor settings"]')!;
  button.focus();
  await act(async () => button.click());
  const dialog = host.querySelector<HTMLDialogElement>('dialog[aria-label="Editor settings"]')!;
  expect(dialog.open).toBe(true);
  const checkboxes = dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect(checkboxes).toHaveLength(12);
  expect(dialog.querySelector('[aria-labelledby="smart-input-smartTables-label"]')).not.toBeNull();
  expect(dialog.querySelector('[aria-labelledby="smart-input-wikiCompletion-label"]')).not.toBeNull();
  expect(dialog.querySelector('[aria-labelledby="smart-input-tagCompletion-label"]')).not.toBeNull();
  expect(document.activeElement).toBe(checkboxes[0]);
  await act(async () => checkboxes[0]!.click());
  expect(checkboxes[0]!.checked).toBe(false);
  const done = [...dialog.querySelectorAll("button")].find((item) => item.textContent === "Done")!;
  await act(async () => done.click());
  expect(document.activeElement).toBe(button);
  await key(",", mod());
  expect(host.querySelector<HTMLInputElement>('dialog input[type="checkbox"]')?.checked).toBe(false);
});
