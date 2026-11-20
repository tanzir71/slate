import { act, createElement, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { markdownHeadings, parseSheet } from "@slate/core";
import Inspector from "../src/browser/Inspector";
import { createCursorStore } from "../src/commands";
import type { NativeFileModel } from "../src/browser/useNativeFileInfo";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const source = "\uFEFF# Root\r\n\r\n## Alpha\r\nA\r\n\r\n## Beta\r\nB\r\n";
async function mount(readOnly = false, nativeFile?: NativeFileModel) {
  const cursor = createCursorStore(), move = vi.fn(() => true), captureMove = vi.fn(() => ({ move }));
  const onJump = vi.fn(() => true), onOpen = vi.fn(), onClose = vi.fn();
  const rendered = vi.fn();
  const incoming = parseSheet("# Incoming\n\nSee [[note.md|these words]] for scope.", "incoming.md");
  async function render(raw = source) {
    const document = { ...parseSheet(raw, "note.md"), headings: markdownHeadings(raw) };
    await act(async () => root.render(createElement(Profiler, { id: "inspector", onRender: rendered }, createElement(Inspector, { document, documents: [document, incoming], path: "note.md", cursor,
      readOnly, closeShortcut: "Ctrl+Shift+I", onClose, onJump, onOpen, captureMove, ...(nativeFile ? { nativeFile } : {}) }))));
  }
  await render();
  const heading = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".inspectorHeading")].find(button => button.getAttribute("aria-label")?.startsWith(`Jump to ${label} (`))!;
  return { cursor, move, captureMove, onJump, onOpen, onClose, render, heading, rendered };
}
function transfer() {
  const values = new Map<string, string>();
  return { types: [] as string[], effectAllowed: "", dropEffect: "", setData(type: string, value: string) { this.types.push(type); values.set(type, value); }, getData(type: string) { return values.get(type) ?? ""; } };
}
async function drag(element: HTMLElement, type: string, dataTransfer: ReturnType<typeof transfer>) {
  const event = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  await act(async () => { element.dispatchEvent(event); }); return event;
}
async function pointer(element: HTMLElement, type: string, fields: { pointerId?: number; pointerType?: string; clientX?: number; clientY?: number } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true }); Object.assign(event, { pointerId: 7, pointerType: "touch", clientX: 10, clientY: 10, ...fields });
  await act(async () => { element.dispatchEvent(event); }); return event;
}

it("moves a touched grip through one captured source guard and cancels pointer loss without an edit", async () => {
  const actions = await mount(), grip = actions.heading("Beta").querySelector<HTMLElement>(".inspectorGrip") ?? actions.heading("Beta");
  Object.defineProperties(grip, { setPointerCapture: { value: vi.fn() }, hasPointerCapture: { value: () => false } });
  const original = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => actions.heading("Alpha") });
  try {
    await pointer(grip, "pointerdown"); expect(actions.captureMove).toHaveBeenCalledExactlyOnceWith(source);
    await pointer(grip, "pointermove", { clientY: 30 });
    expect(actions.heading("Alpha").getAttribute("data-drop-before")).toBe("true");
    await pointer(grip, "pointerup", { pointerId: 99 }); expect(actions.move).not.toHaveBeenCalled();
    await pointer(grip, "pointerup", { clientY: 30 }); expect(actions.move).toHaveBeenCalledExactlyOnceWith(2, 1); expect(actions.onJump).not.toHaveBeenCalled();
    actions.move.mockClear(); await pointer(grip, "pointerdown"); await pointer(grip, "pointermove", { clientY: 30 });
    await pointer(grip, "pointercancel"); await pointer(grip, "pointerup", { clientY: 30 }); expect(actions.move).not.toHaveBeenCalled();
  } finally { if (original) Object.defineProperty(document, "elementFromPoint", original); else Reflect.deleteProperty(document, "elementFromPoint"); }
});

it("keeps mouse input and read-only touch outside the touch move path", async () => {
  const actions = await mount(true), grip = actions.heading("Beta").querySelector<HTMLElement>(".inspectorGrip") ?? actions.heading("Beta");
  await pointer(grip, "pointerdown"); await pointer(grip, "pointermove", { clientY: 30 }); await pointer(grip, "pointerup");
  await pointer(grip, "pointerdown", { pointerType: "mouse" });
  expect(actions.captureMove).not.toHaveBeenCalled(); expect(actions.move).not.toHaveBeenCalled();
});

it("shows semantic heading levels, tracks the live cursor, and jumps to exact raw offsets", async () => {
  const actions = await mount();
  await act(async () => actions.cursor.update({ line: 8, column: 1, lines: 9 }));
  expect(actions.heading("Beta").getAttribute("aria-current")).toBe("location");
  await act(async () => actions.heading("Alpha").click());
  expect(actions.onJump).toHaveBeenCalledExactlyOnceWith(source, source.indexOf("## Alpha"));
  expect(actions.captureMove).not.toHaveBeenCalled();
});

it("does not rerender the Inspector for cursor movement within the same heading's section", async () => {
  const actions = await mount();
  await act(async () => actions.cursor.update({ line: 8, column: 1, lines: 12 })); actions.rendered.mockClear();
  await act(async () => actions.cursor.update({ line: 8, column: 2, lines: 12 }));
  await act(async () => actions.cursor.update({ line: 9, column: 1, lines: 12 }));
  expect(actions.rendered).not.toHaveBeenCalled(); expect(actions.heading("Beta").getAttribute("aria-current")).toBe("location");
});

it("moves keyboard siblings through a fresh guarded request and preserves focused row identity", async () => {
  const actions = await mount(), beta = actions.heading("Beta"); beta.focus();
  await act(async () => beta.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true, cancelable: true })));
  expect(actions.captureMove).toHaveBeenCalledExactlyOnceWith(source); expect(actions.move).toHaveBeenCalledExactlyOnceWith(2, 1);
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Section moved.");
  await actions.render("\uFEFF# Root\r\n\r\n## Beta\r\nB\r\n\r\n## Alpha\r\nA\r\n");
  expect(document.activeElement).toBe(actions.heading("Beta")); expect(actions.heading("Beta")).toBe(beta);
});

it("follows a moved duplicate heading to its new occurrence without stealing a later focus choice", async () => {
  const actions = await mount(), initial = "## Repeated\nFirst body.\n\n## Repeated\nSecond body.\n", reordered = "## Repeated\nSecond body.\n\n## Repeated\nFirst body.\n";
  const rows = () => host.querySelectorAll<HTMLButtonElement>('.inspectorHeading[aria-label="Jump to Repeated (H2)"]');
  await actions.render(initial); rows()[0]!.focus();
  await act(async () => rows()[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true })));
  expect(actions.move).toHaveBeenCalledExactlyOnceWith(0, 2);
  await actions.render(reordered); expect(document.activeElement).toBe(rows()[1]);
  await actions.render(initial); rows()[0]!.focus();
  await act(async () => rows()[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true })));
  const close = host.querySelector<HTMLButtonElement>('.inspectorClose')!; close.focus();
  await actions.render(reordered); expect(document.activeElement).toBe(close);
});

it("keeps composing, AltGr, browser shortcuts and read-only outlines outside movement", async () => {
  const actions = await mount();
  for (const init of [{ altKey: false }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { isComposing: true }]) {
    await act(async () => actions.heading("Beta").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true, ...init })));
  }
  expect(actions.captureMove).not.toHaveBeenCalled();
  const readOnly = await mount(true);
  expect(readOnly.heading("Beta").draggable).toBe(false);
  await act(async () => readOnly.heading("Beta").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true })));
  await drag(readOnly.heading("Beta"), "dragstart", transfer()); expect(readOnly.captureMove).not.toHaveBeenCalled();
  await act(async () => readOnly.heading("Beta").click()); expect(readOnly.onJump).toHaveBeenCalled();
});

it("binds a drag to its captured target/token and reports a stale rejection without another capture", async () => {
  const actions = await mount(), data = transfer();
  actions.move.mockReturnValue(false);
  await drag(actions.heading("Beta"), "dragstart", data);
  expect(actions.captureMove).toHaveBeenCalledExactlyOnceWith(source);
  await drag(actions.heading("Alpha"), "drop", transfer()); expect(actions.move).not.toHaveBeenCalled();
  await drag(actions.heading("Alpha"), "dragover", data);
  expect(actions.heading("Alpha").getAttribute("data-drop-before")).toBe("true");
  await drag(actions.heading("Alpha"), "drop", data);
  expect(actions.move).toHaveBeenCalledExactlyOnceWith(2, 1); expect(actions.captureMove).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="status"]')?.textContent).toContain("sheet may have changed");
});

it("opens the real backlink source, exposes file statistics on request and closes through its control", async () => {
  const actions = await mount();
  expect(host.querySelector(".inspectorSnippet")?.textContent).toContain("See these words for scope.");
  await act(async () => host.querySelector<HTMLButtonElement>(".inspectorBacklink")!.click()); expect(actions.onOpen).toHaveBeenCalledExactlyOnceWith("incoming.md");
  expect(host.textContent).not.toContain("UTF-8 bytes");
  const info = [...host.querySelectorAll<HTMLButtonElement>(".inspectorSections button")].find(button => button.textContent === "Info")!;
  // jsdom has no scrolling; actual navigation geometry is verified in the browser.
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  await act(async () => info.click()); expect(info.getAttribute("aria-pressed")).toBe("true"); expect(host.textContent).toContain("UTF-8 bytes");
  expect(host.querySelector(".inspectorFilePath")?.textContent).toBe("note.md");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close inspector"]')!.click()); expect(actions.onClose).toHaveBeenCalledTimes(1);
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

it("shows real native location and reveals from a read-only sheet without enabling source mutation", async () => {
  const nativeFile: NativeFileModel = { info: { absolutePath: "C:\\Notes\\note.md", bytes: 57, modifiedAt: 1795132800000, revealLabel: "Show in Explorer" },
    pending: false, revealing: false, error: "", refresh: vi.fn(), reveal: vi.fn(), retry: vi.fn() };
  const actions = await mount(true, nativeFile);
  expect(host.querySelector(".inspectorFilePath")?.textContent).toBe(nativeFile.info!.absolutePath);
  const reveal = host.querySelector<HTMLButtonElement>(".inspectorReveal")!;
  expect(reveal.disabled).toBe(false); await act(async () => reveal.click()); expect(nativeFile.reveal).toHaveBeenCalledTimes(1);
  expect(actions.captureMove).not.toHaveBeenCalled();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".inspectorSections button")].find(button => button.textContent === "Info")!.click());
  expect(nativeFile.refresh).toHaveBeenCalledTimes(1); expect(host.textContent).toContain("Saved bytes"); expect(host.querySelector("time")?.getAttribute("dateTime")).toBe(new Date(nativeFile.info!.modifiedAt!).toISOString());
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});
