import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BrowserApp } from "../src/browser/BrowserApp";
import { performance as nodePerformance } from "node:perf_hooks";

const opening = vi.hoisted(() => ({ editorLoads: 0, filesStarted: false }));
vi.mock("../src/browser/BrowserWorkspace", () => ({ default: () => null }));
vi.mock("../src/MarkdownEditor", () => ({ MarkdownEditor: () => null }));
vi.mock("../src/browser/WorkspaceDocumentEditor", () => {
  opening.editorLoads++;
  return { default: () => null };
});
vi.mock("@slate/storage/browser-catalog", () => ({
  async listBrowserSpaces() { return [{ id: "preload-library", name: "Notes", tier: "library" }]; },
  openBrowserLibrary() { opening.filesStarted = true; return new Promise<never>(() => {}); },
  async rememberBrowserSpace() {},
}));
vi.mock("@slate/storage/browser-ownership", () => ({ createBrowserOwnership() { throw new Error("Ownership must wait for files"); } }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("starts loading the real document-editor boundary while library files are still opening", async () => {
  vi.stubGlobal("performance", nodePerformance);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  localStorage.setItem("slate.last-space", "preload-library");
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host);
  const theme = document.documentElement.getAttribute("data-theme"), style = document.documentElement.getAttribute("style");
  try {
    await act(async () => root.render(createElement(BrowserApp)));
    await vi.waitFor(() => expect(opening.filesStarted).toBe(true));
    await vi.waitFor(() => expect(opening.editorLoads).toBe(1));
    expect(host.querySelector(".cm-content")).toBeNull();
  } finally {
    await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.unstubAllGlobals();
    for (const [name, value] of [["data-theme", theme], ["style", style]] as const)
      if (value === null) document.documentElement.removeAttribute(name); else document.documentElement.setAttribute(name, value);
  }
});
