import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { performance as nodePerformance } from "node:perf_hooks";
import { createMemoryFiles, type BrowserDirectoryHandle } from "@slate/storage/browser-files";
import type { BrowserSpaceRecord } from "@slate/storage/browser-catalog";
import type { WorkspaceFiles } from "@slate/storage/file-io";
import type { WorkspaceStore } from "../src/browser/workspaceStore";
import { BrowserApp } from "../src/browser/BrowserApp";

const fixture = vi.hoisted(() => ({
  records: [] as BrowserSpaceRecord[],
  files: undefined as WorkspaceFiles | undefined,
  opened: undefined as WorkspaceStore | undefined,
  pending: undefined as Promise<void> | undefined,
  remember: vi.fn<(record: BrowserSpaceRecord) => Promise<unknown>>(),
}));
vi.mock("../src/browser/BrowserWorkspace", () => ({
  default: ({ store, onKeepSample, onSwitchSpace }: {
    store: WorkspaceStore; onKeepSample(): Promise<void>; onSwitchSpace(): Promise<void>;
  }) => {
    fixture.opened = store;
    return createElement("div", { className: "openedSpace" },
      createElement("p", null, store.api.getState().sheets.map((sheet) => sheet.content).join("\n")),
      createElement("button", { onClick: () => { fixture.pending = onKeepSample(); } }, "Keep sample"),
      createElement("button", { onClick: onSwitchSpace }, "Switch Space"));
  },
}));
vi.mock("../src/browser/WorkspaceDocumentEditor", () => ({ default: () => null }));
vi.mock("@slate/storage/browser-catalog", () => ({
  async listBrowserSpaces() { return fixture.records; },
  async openBrowserLibrary() { return fixture.files!; },
  rememberBrowserSpace(record: BrowserSpaceRecord) { return fixture.remember(record); },
}));
vi.mock("@slate/storage/browser-files", async (importOriginal) => ({
  ...await importOriginal<typeof import("@slate/storage/browser-files")>(),
  createDirectoryFiles: () => fixture.files!,
}));
vi.mock("@slate/storage/browser-ownership", () => ({
  createBrowserOwnership(_id: string, onChange: (owned: boolean) => void) {
    return {
      async acquire() { onChange(true); return true; },
      async close() { onChange(false); },
      notify() {},
    };
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
let theme: string | null, style: string | null;
const saved: BrowserSpaceRecord = { id: "saved-library", name: "My saved notes", tier: "library" };
const source = "\uFEFF# Saved\r\n\r\nKeep my বাংলা words.\r\n";

beforeEach(() => {
  fixture.records = [saved];
  fixture.files = createMemoryFiles({ "Saved.md": source });
  fixture.opened = undefined;
  fixture.pending = undefined;
  fixture.remember.mockReset().mockRejectedValue(new Error("Catalog writes unavailable"));
  vi.stubGlobal("performance", nodePerformance);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  theme = document.documentElement.getAttribute("data-theme");
  style = document.documentElement.getAttribute("style");
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); localStorage.clear(); vi.unstubAllGlobals();
  for (const [name, value] of [["data-theme", theme], ["style", style]] as const)
    if (value === null) document.documentElement.removeAttribute(name); else document.documentElement.setAttribute(name, value);
});

async function render() { await act(async () => root.render(createElement(BrowserApp))); }
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find((element) => element.textContent === text);
  expect(button, text).toBeTruthy();
  await act(async () => { button!.click(); await fixture.pending; });
}
async function expectSavedOpen() {
  await vi.waitFor(() => expect(host.querySelector(".openedSpace")?.textContent ?? "").toContain("Keep my বাংলা words."));
  expect(fixture.remember).not.toHaveBeenCalled();
  expect(fixture.opened?.api.getState().owned).toBe(true);
  expect(await fixture.files!.read("Saved.md")).toEqual(new TextEncoder().encode(source));
  expect(host.querySelector('[role="alert"]')).toBeNull();
}

it("automatically restores saved library words without rewriting an unchanged catalog record", async () => {
  localStorage.setItem("slate.last-space", saved.id);
  await render();
  await expectSavedOpen();
});

it("opens a saved library from the welcome screen without requiring a catalog write", async () => {
  await render();
  await click("Open My saved notes");
  await expectSavedOpen();
  expect(localStorage.getItem("slate.last-space")).toBe(saved.id);
});

it("reconnects a saved folder only after permission and keeps its original catalog record", async () => {
  const requestPermission = vi.fn<NonNullable<BrowserDirectoryHandle["requestPermission"]>>().mockResolvedValue("granted");
  const unused = async (): Promise<never> => { throw new Error("Use the supplied file adapter"); };
  const handle: BrowserDirectoryHandle = {
    kind: "directory", name: "My folder", requestPermission,
    async *entries() {}, getDirectoryHandle: unused, getFileHandle: unused, removeEntry: unused,
  };
  fixture.records = [{ ...saved, tier: "folder", handle }];
  await render();
  await click("Reconnect My saved notes");
  await expectSavedOpen();
  expect(requestPermission).toHaveBeenCalledExactlyOnceWith({ mode: "readwrite" });
});

it("keeps a new library unavailable until its catalog record is durably saved", async () => {
  fixture.records = [];
  let finish!: () => void;
  fixture.remember.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  await render();
  await click("Continue");
  expect(fixture.remember).toHaveBeenCalledTimes(1);
  const record = fixture.remember.mock.calls[0]![0];
  expect(record).toMatchObject({ name: "My writing", tier: "library" });
  expect(record.id).not.toBe(saved.id);
  expect(host.querySelector(".openedSpace")).toBeNull();
  expect(localStorage.getItem("slate.last-space")).toBeNull();
  await act(async () => finish());
  await vi.waitFor(() => expect(host.querySelector(".openedSpace")).not.toBeNull());
  expect(localStorage.getItem("slate.last-space")).toBe(record.id);
});

it("reports failed new-Space persistence without exposing a writing workspace", async () => {
  fixture.records = [];
  await render();
  await click("Continue");
  expect(fixture.remember).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Catalog writes unavailable");
  expect(host.querySelector(".openedSpace")).toBeNull();
  expect(localStorage.getItem("slate.last-space")).toBeNull();
});

it("requires a new catalog entry when keeping a temporary sample", async () => {
  await import("../src/sampleData");
  await render();
  const sample = host.querySelector<HTMLInputElement>('input[value="sample"]')!;
  await act(async () => sample.click());
  await click("Continue");
  await vi.waitFor(() => expect(host.querySelector(".openedSpace")).not.toBeNull());
  expect(fixture.remember).not.toHaveBeenCalled();
  fixture.remember.mockResolvedValue(undefined);
  await click("Keep sample");
  expect(fixture.remember).toHaveBeenCalledTimes(1);
  expect(fixture.remember.mock.calls[0]![0]).toMatchObject({ name: "My writing", tier: "library" });
  expect(fixture.remember.mock.calls[0]![0].id).not.toBe("sample");
});
