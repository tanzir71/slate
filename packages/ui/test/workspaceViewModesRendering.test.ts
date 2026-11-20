import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { parseSheet, type SheetDocument } from "@slate/core";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import BrowserWorkspace from "../src/browser/BrowserWorkspace";
import { createWorkspaceStore } from "../src/browser/workspaceStore";

const summaries = vi.hoisted(() => ({ documents: [] as SheetDocument[] }));
vi.mock("../src/browser/useSheetSummaries", () => ({ useSheetSummaries: () => summaries.documents }));
vi.mock("../src/blocks/useBlockLibrary", () => ({ useBlockLibrary: () => ({ library: undefined }) }));
vi.mock("../src/blocks/useTemplateLibrary", () => ({ useTemplateLibrary: () => ({ library: undefined }) }));
vi.mock("../src/snippets/useSnippetLibrary", () => ({ useSnippetLibrary: () => ({ library: undefined, snapshot: undefined, session: undefined }) }));
vi.mock("../src/browser/WorkspaceDocumentEditor", async () => {
  const { createElement } = await import("react");
  return { default: (props: { path: string; sourceMode: boolean; readOnly: boolean }) => createElement("div", {
    "data-mode-editor": props.path, "data-source": String(props.sourceMode), "data-readonly": String(props.readOnly),
  }) };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: { root: Root; host: HTMLDivElement }[] = [];
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value() {} });
});
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) { await act(async () => root.unmount()); host.remove(); }
  summaries.documents = []; localStorage.clear(); history.replaceState(null, "", "/"); vi.restoreAllMocks();
});
afterAll(() => {
  vi.unstubAllGlobals();
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});
const original = "\uFEFF# Alpha\r\n\r\n**Words kept.**\r\n";
async function fixture(owned = true) {
  const files = createMemoryFiles({ "a.md": original, "b.md": "# Beta\n" });
  const store = createWorkspaceStore({ id: "sample", name: "Notes", tier: "library" }, files);
  await store.load(); await store.select("a.md"); store.api.setState({ owned });
  summaries.documents = store.api.getState().sheets.map(sheet => parseSheet(sheet.content, sheet.path));
  const write = vi.spyOn(files, "write"), refresh = vi.spyOn(store, "refresh").mockResolvedValue();
  return { store, files, write, refresh };
}
async function mount(store: ReturnType<typeof createWorkspaceStore>) {
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host);
  mounted.push({ root, host });
  const props: ComponentProps<typeof BrowserWorkspace> = { store, createIndex: undefined,
    appearance: { preference: "light", change() {} }, async onKeepSample() {}, async onTakeover() {},
    async onSwitchSpace() {}, onAbout() {}, onInstall: undefined };
  await act(async () => root.render(createElement(BrowserWorkspace, props)));
  await act(async () => vi.dynamicImportSettled());
  return host;
}
async function cycle(target: EventTarget = window, extra: KeyboardEventInit = {}) {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const event = new KeyboardEvent("keydown", { key: "e", code: "KeyE", ctrlKey: !mac, metaKey: mac,
    bubbles: true, cancelable: true, ...extra });
  await act(async () => target.dispatchEvent(event)); return event;
}
function editor(host: HTMLElement, path = "a.md") { return host.querySelector(`[data-mode-editor="${path}"]`)!; }
function selectedMode(host: HTMLElement) { return host.querySelector('.headerViewMode [aria-checked="true"]')?.textContent; }

it("cycles the actual workspace Live, Source, Read and Live without changing physical file bytes", async () => {
  const { store, files, write } = await fixture(), host = await mount(store);
  expect(selectedMode(host)).toBe("Live");
  expect((await cycle()).defaultPrevented).toBe(true);
  expect(selectedMode(host)).toBe("Source"); expect(editor(host).getAttribute("data-source")).toBe("true");
  await cycle(); expect(selectedMode(host)).toBe("Read"); expect(editor(host).getAttribute("data-readonly")).toBe("true");
  expect(editor(host).getAttribute("data-source")).toBe("false");
  await cycle(); expect(selectedMode(host)).toBe("Live"); expect(editor(host).getAttribute("data-readonly")).toBe("false");
  expect(await files.read("a.md")).toEqual(encodeText(original)); expect(write).not.toHaveBeenCalled();
});

it("remembers each sheet across selection and a workspace remount", async () => {
  const { store, write } = await fixture(), host = await mount(store);
  await cycle();
  await act(async () => store.select("b.md")); expect(selectedMode(host)).toBe("Live");
  await cycle(); await cycle(); expect(selectedMode(host)).toBe("Read");
  await act(async () => store.select("a.md")); expect(selectedMode(host)).toBe("Source");
  const first = mounted.shift()!; await act(async () => first.root.unmount()); first.host.remove();
  const reopened = await mount(store); expect(selectedMode(reopened)).toBe("Source");
  expect(editor(reopened).getAttribute("data-source")).toBe("true");
  await act(async () => store.select("b.md")); expect(selectedMode(reopened)).toBe("Read");
  expect(editor(reopened, "b.md").getAttribute("data-readonly")).toBe("true"); expect(write).not.toHaveBeenCalled();
});

it("allows a nonowning reader to choose modes while both editable modes remain read-only", async () => {
  const { store, write } = await fixture(false), host = await mount(store);
  await cycle(); expect(selectedMode(host)).toBe("Source"); expect(editor(host).getAttribute("data-readonly")).toBe("true");
  await cycle(); await cycle(); expect(selectedMode(host)).toBe("Live");
  expect(editor(host).getAttribute("data-readonly")).toBe("true"); expect(write).not.toHaveBeenCalled();
});

it("leaves composing input and open dialogs alone", async () => {
  const { store } = await fixture(), host = await mount(store);
  expect((await cycle(window, { isComposing: true })).defaultPrevented).toBe(false);
  const input = host.appendChild(document.createElement("input")); input.focus();
  expect((await cycle(input)).defaultPrevented).toBe(false);
  const dialog = host.appendChild(document.createElement("dialog")); dialog.setAttribute("open", "");
  expect((await cycle()).defaultPrevented).toBe(false); expect(selectedMode(host)).toBe("Live");
});
