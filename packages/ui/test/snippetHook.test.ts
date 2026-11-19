import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createMemoryFiles, encodeText } from "@slate/storage/browser-files";
import {
  createBrowserSpace,
  createSnippetFileStore,
  globalSnippetPath,
} from "@slate/storage/browser-space";
import { openGlobalSnippetFileStore } from "@slate/storage/browser-catalog";
import { createWorkspaceStore } from "../src/browser/workspaceStore";
import { useSnippetLibrary } from "../src/snippets/useSnippetLibrary";

vi.mock("@slate/storage/browser-catalog", () => ({
  openGlobalSnippetFileStore: vi.fn(),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("keeps snippets usable when advisory cross-tab messaging is unavailable, including StrictMode reopen and focus reload", async () => {
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      constructor() {
        throw new Error("Messaging blocked");
      }
    },
  );
  vi.mocked(openGlobalSnippetFileStore).mockResolvedValue(
    createSnippetFileStore(
      createBrowserSpace(createMemoryFiles()),
      globalSnippetPath,
      (action) => action(),
    ),
  );
  const files = createMemoryFiles(),
    store = createWorkspaceStore(
      { id: "sample", name: "Sample", tier: "library" },
      files,
    );
  const host = document.createElement("div"),
    root = createRoot(host);
  function Reader() {
    const { snapshot } = useSnippetLibrary(store);
    return createElement(
      "p",
      null,
      snapshot?.loading === false
        ? snapshot.snippets.map((item) => item.trigger).join(",")
        : "Loading",
    );
  }
  try {
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(Reader)));
    });
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(host.textContent).toBe(";today,;tbl,;sig");
    await files.write(
      ".slate/snippets.json",
      encodeText(
        JSON.stringify({
          version: 1,
          snippets: [{ trigger: ";local", body: "Local" }],
        }),
      ),
    );
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(host.textContent).toBe(";today,;tbl,;sig,;local");
    expect(store.api.getState().error).toBe("");
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});
