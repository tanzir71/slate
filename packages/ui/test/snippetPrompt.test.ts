import { act, createElement, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { readSnippetConfiguration } from "@slate/core";
import SnippetPrompt from "../src/snippets/SnippetPrompt";
import {
  createSnippetInvocation,
  prepareSnippet,
} from "../src/snippets/snippetSession";

vi.mock("../src/browser/WorkspaceDialog", () => ({
  WorkspaceDialog: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.unstubAllGlobals();
});

it("accepts an explicit clipboard read after StrictMode effect replay and keeps its field syntax literal", async () => {
  const readText = vi.fn().mockResolvedValue("${9:literal} {{date}}"),
    host = document.createElement("div"),
    root = createRoot(host);
  vi.stubGlobal("navigator", { clipboard: { readText } });
  const definition = readSnippetConfiguration({
    version: 1,
    snippets: [{ trigger: ";clip", body: "${1:{{clipboard}}}$0" }],
  }).snippets[0]!;
  const request = prepareSnippet(
    createSnippetInvocation(
      { source: "", selection: "", element: host, insert: vi.fn() },
      "Writing",
      "Note.md",
    ),
    { ...definition, origin: "space" },
  );
  try {
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(SnippetPrompt, { request, onClose: vi.fn() }),
        ),
      );
    });
    expect(readText).not.toHaveBeenCalled();
    const button = [...host.querySelectorAll("button")].find(
      (element) => element.textContent === "Read clipboard",
    )!;
    await act(async () => {
      button.click();
    });
    expect(readText).toHaveBeenCalledOnce();
    expect(host.querySelector("textarea")?.value).toBe("${9:literal} {{date}}");
    expect(host.querySelector("pre")?.textContent).toBe(
      "${9:literal} {{date}}",
    );
    expect(button.disabled).toBe(false);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});
