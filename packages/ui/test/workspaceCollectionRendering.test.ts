import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { parseSheet, readWorkspacePreferences, type SheetDocument } from "@slate/core";
import { createMemoryFiles } from "@slate/storage/browser-files";
import { SheetList } from "../src/browser/SheetList";
import { NotebookTree } from "../src/browser/NotebookTree";
import BrowserWorkspace from "../src/browser/BrowserWorkspace";
import { createWorkspaceStore } from "../src/browser/workspaceStore";

const summaries = vi.hoisted(() => ({ documents: [] as SheetDocument[] }));
vi.mock("../src/browser/useSheetSummaries", () => ({ useSheetSummaries: () => summaries.documents }));
vi.mock("../src/blocks/useBlockLibrary", () => ({ useBlockLibrary: () => ({ library: undefined }) }));
vi.mock("../src/blocks/useTemplateLibrary", () => ({ useTemplateLibrary: () => ({ library: undefined }) }));
vi.mock("../src/snippets/useSnippetLibrary", () => ({ useSnippetLibrary: () => ({ library: undefined, snapshot: undefined, session: undefined }) }));
vi.mock("../src/browser/WorkspaceDocumentEditor", async () => {
  const { createElement } = await import("react");
  return { default: () => createElement("div", { "data-editor-stub": "" }) };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: { root: Root; host: HTMLDivElement }[] = [];
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
const dialogDescriptors = new Map(["showModal", "close"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]));
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value() {} });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) { await act(async () => root.unmount()); host.remove(); }
  summaries.documents = []; localStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers();
});
afterAll(() => {
  vi.unstubAllGlobals();
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  for (const [name, descriptor] of dialogDescriptors) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});
function mount() {
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host);
  mounted.push({ root, host }); return { root, host };
}
function watchedDocuments(count: number, counter: { reads: number }) {
  return Array.from({ length: count }, (_, index) => {
    const title = `Note ${String(index).padStart(5, "0")}`, path = `Work/Projects/${title}.md`;
    const document = parseSheet(`# ${title}\n\nWords kept. #reference`, path);
    return new Proxy(document, { get(target, key, receiver) {
      if (key === "path" || key === "tags") counter.reads++;
      return Reflect.get(target, key, receiver);
    } });
  });
}

it("changes notebook selection without rescanning 10k file paths and retains descendant counts", async () => {
  let reads = 0;
  const sheetPaths = new Proxy(Array.from({ length: 10_000 }, (_, index) => `Work/Projects/${index}.md`), {
    get(target, key, receiver) { if (typeof key === "string" && /^\d+$/.test(key)) reads++; return Reflect.get(target, key, receiver); },
  });
  const props: ComponentProps<typeof NotebookTree> = { paths: ["Work/Projects"], sheetPaths, selected: "", collapsed: new Set(), onToggle() {}, onSelect() {}, onMove() {} };
  const { root, host } = mount(); await act(async () => root.render(createElement(NotebookTree, props)));
  expect(host.querySelector('[aria-label="Notebook Work"] small')?.textContent).toBe("10000");
  reads = 0;
  await act(async () => root.render(createElement(NotebookTree, { ...props, selected: "Work/Projects" })));
  expect(host.querySelector('[aria-label="Notebook Work/Projects"]')?.getAttribute("aria-current")).toBe("page");
  expect(host.querySelector('[aria-label="Notebook Work/Projects"] small')?.textContent).toBe("10000");
  expect(reads).toBe(0);
});

it("updates sheet action availability without rereading the full 10k-sheet collection", async () => {
  const counter = { reads: 0 }, sheets = watchedDocuments(10_000, counter);
  const props: ComponentProps<typeof SheetList> = { sheets, selectedPath: sheets[0]!.path, preferences: readWorkspacePreferences(), owned: true, pending: false, readOnlyPaths: new Set(), onOpen() {}, onBulk() {} };
  const { root, host } = mount(); await act(async () => root.render(createElement(SheetList, props)));
  counter.reads = 0;
  await act(async () => root.render(createElement(SheetList, { ...props, owned: false })));
  expect(host.querySelector<HTMLButtonElement>(".sheetSelectionControls button")?.disabled).toBe(true);
  expect(host.querySelectorAll(".browserSheetRow").length).toBeLessThan(25);
  expect(counter.reads).toBeLessThan(256);
});

it.each([0, 9_999])("opens the actual workspace palette from row %s without rereading all 10k cached document records", async selected => {
  const counter = { reads: 0 }; summaries.documents = watchedDocuments(10_000, counter);
  const store = createWorkspaceStore({ id: "sample", name: "Notes", tier: "library" }, createMemoryFiles());
  const files = summaries.documents.map(document => ({ path: document.path, content: document.raw }));
  store.api.setState({ sheets: files, selectedPath: files[selected]!.path });
  vi.spyOn(store, "refresh").mockResolvedValue();
  const props: ComponentProps<typeof BrowserWorkspace> = { store, createIndex: undefined, appearance: { preference: "light", change() {} }, async onKeepSample() {}, async onTakeover() {}, async onSwitchSpace() {}, onAbout() {}, onInstall: undefined };
  const { root, host } = mount(); await act(async () => root.render(createElement(BrowserWorkspace, props)));
  expect(host.querySelector(".listHeading > small")?.textContent).toBe("10000");
  counter.reads = 0;
  const event = new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, bubbles: true, cancelable: true });
  await act(async () => window.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  const dialog = host.querySelector<HTMLDialogElement>('.slatePalette[open]');
  expect(dialog).not.toBeNull(); expect(document.activeElement).toBe(dialog!.querySelector("input"));
  expect(counter.reads).toBeLessThan(256);
});

it("invalidates notebook topology and counts when immutable file inputs change", async () => {
  const props: ComponentProps<typeof NotebookTree> = { paths: Object.freeze(["Work/Projects", "Work/Projects2", "Empty"]), sheetPaths: Object.freeze(["Work/Projects/a.md", "Work/Projects2/b.md", "Work/Projects-paper.md"]), selected: "", collapsed: new Set(), onToggle() {}, onSelect() {}, onMove() {} };
  const { root, host } = mount(); await act(async () => root.render(createElement(NotebookTree, props)));
  expect(host.querySelector('[aria-label="Notebook Work"] small')?.textContent).toBe("3");
  expect(host.querySelector('[aria-label="Notebook Work/Projects"] small')?.textContent).toBe("1");
  expect(host.querySelector('[aria-label="Notebook Empty"] small')?.textContent).toBe("0");
  await act(async () => root.render(createElement(NotebookTree, { ...props, paths: ["Other", "Empty"], sheetPaths: ["Other/one.md"] })));
  expect(host.querySelector('[aria-label="Notebook Work"]')).toBeNull();
  expect(host.querySelector('[aria-label="Notebook Other"] small')?.textContent).toBe("1");
  expect(host.querySelector('[aria-label="Notebook Empty"] small')?.textContent).toBe("0");
});

it("keeps selection owned by the list and recomputes eligibility after read-only changes", async () => {
  const sheets = [parseSheet("# Alpha", "a.md"), parseSheet("# Beta", "b.md")], calls: string[][] = [];
  const props: ComponentProps<typeof SheetList> = { sheets, selectedPath: "a.md", preferences: readWorkspacePreferences(), owned: true, pending: false, readOnlyPaths: new Set(), onOpen() {}, onBulk(_kind, paths) { calls.push([...paths]); paths.length = 0; } };
  const { root, host } = mount(); await act(async () => root.render(createElement(SheetList, props)));
  await act(async () => host.querySelector<HTMLButtonElement>(".sheetSelectionControls button")!.click());
  await act(async () => host.querySelector<HTMLInputElement>('[aria-label="Select all filtered sheets"]')!.click());
  const move = () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Move")!;
  await act(async () => move().click());
  expect(calls).toEqual([["a.md", "b.md"]]);
  await act(async () => root.render(createElement(SheetList, { ...props, owned: false })));
  expect(host.querySelector(".sheetSelectionControls")!.textContent).toContain("2 selected");
  await act(async () => root.render(createElement(SheetList, { ...props, readOnlyPaths: new Set(["a.md"]) })));
  expect(host.querySelector(".sheetSelectionControls")!.textContent).toContain("1 selected");
  expect(host.querySelector<HTMLInputElement>('[aria-label="Select Alpha"]')!.disabled).toBe(true);
  await act(async () => move().click()); expect(calls[1]).toEqual(["b.md"]);
  await act(async () => root.render(createElement(SheetList, { ...props, pending: true })));
  expect(move().disabled).toBe(true);
});

it("rechecks recent files on the next root render after the clock changes", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-18T12:00:00Z"));
  const document = parseSheet("---\nupdated: 2026-11-17T12:00:00Z\n---\n# Recent", "Recent.md");
  summaries.documents = [document];
  const store = createWorkspaceStore({ id: "sample", name: "Notes", tier: "library" }, createMemoryFiles());
  const files = [{ path: document.path, content: document.raw }]; store.api.setState({ sheets: files, selectedPath: document.path });
  vi.spyOn(store, "refresh").mockResolvedValue();
  const props: ComponentProps<typeof BrowserWorkspace> = { store, createIndex: undefined, appearance: { preference: "light", change() {} }, async onKeepSample() {}, async onTakeover() {}, async onSwitchSpace() {}, onAbout() {}, onInstall: undefined };
  const { root, host } = mount(); await act(async () => root.render(createElement(BrowserWorkspace, props)));
  const recent = Array.from(host.querySelectorAll<HTMLButtonElement>(".navItem")).find(button => button.textContent === "Edited recently")!;
  await act(async () => recent.click()); expect(host.querySelector(".listHeading > small")!.textContent).toBe("1");
  vi.setSystemTime(new Date("2026-11-26T12:00:00Z"));
  await act(async () => root.render(createElement(BrowserWorkspace, { ...props, appearance: { ...props.appearance } })));
  expect(host.querySelector(".listHeading > small")!.textContent).toBe("0");
  expect(store.api.getState().sheets).toBe(files); expect(store.api.getState().sheets[0]!.content).toBe(document.raw);
});

it("invalidates pin, tag, notebook and read-only projections when their real inputs change", async () => {
  const first = parseSheet("# Alpha\n\n#work #work/project", "Work/a.md"), second = parseSheet("# Beta\n\n#work/project", "Other/b.md");
  summaries.documents = [first, second];
  const store = createWorkspaceStore({ id: "sample", name: "Notes", tier: "library" }, createMemoryFiles());
  store.api.setState({ sheets: [first, second].map(document => ({ path: document.path, content: document.raw })), selectedPath: first.path });
  vi.spyOn(store, "refresh").mockResolvedValue();
  const props: ComponentProps<typeof BrowserWorkspace> = { store, createIndex: undefined, appearance: { preference: "light", change() {} }, async onKeepSample() {}, async onTakeover() {}, async onSwitchSpace() {}, onAbout() {}, onInstall: undefined };
  const { root, host } = mount(); await act(async () => root.render(createElement(BrowserWorkspace, props)));
  const pinCount = () => Array.from(host.querySelectorAll<HTMLButtonElement>(".navItem")).find(button => button.textContent?.startsWith("Pinned"))!.querySelector("span")!.textContent;
  const tagCount = () => Array.from(host.querySelectorAll<HTMLButtonElement>(".browserSidebar button")).find(button => button.querySelector(".navLabel")?.textContent === "work")?.querySelector("small")?.textContent;
  expect(pinCount()).toBe("0"); expect(tagCount()).toBe("2");
  await act(async () => store.togglePinned(first.path)); expect(pinCount()).toBe("1");
  await act(async () => {
    summaries.documents = [second];
    store.api.setState({ sheets: [{ path: second.path, content: second.raw }], selectedPath: second.path });
  });
  expect(pinCount()).toBe("0"); expect(tagCount()).toBeUndefined();
  expect(host.querySelector('[aria-label="Notebook Work"]')).toBeNull();
  expect(host.querySelector('[aria-label="Notebook Other"] small')?.textContent).toBe("1");
  await act(async () => store.api.setState({ sheets: [{ path: second.path, content: second.raw, unsupportedEncoding: true }] }));
  expect(host.querySelector<HTMLButtonElement>(".sheetSelectionControls button")!.disabled).toBe(true);
  expect(host.querySelector(".browserEditor")!.textContent).toContain("This file needs UTF-8.");
  expect(store.api.getState().sheets[0]!.content).toBe(second.raw);
});
