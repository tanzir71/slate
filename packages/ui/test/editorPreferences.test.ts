import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  defaultEditorPreferences,
  type SmartListPreferences,
} from "@slate/core";
import {
  editorPreferenceKey,
  useEditorPreferences,
} from "../src/editorPreferences";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

async function mounted() {
  const host = document.createElement("div");
  const root = createRoot(host);
  let preferences: ReturnType<typeof useEditorPreferences>;
  function Reader() {
    preferences = useEditorPreferences();
    return createElement("p", null, JSON.stringify(preferences.preferences));
  }
  await act(async () => root.render(createElement(Reader)));
  return {
    host,
    root,
    get current() {
      return preferences;
    },
  };
}

it("persists changes, reopens preferences and follows cross-tab changes or removal", async () => {
  const first = await mounted();
  try {
    expect(first.current.preferences).toEqual(defaultEditorPreferences);
    await act(async () => {
      first.current.change("continuation", false);
      first.current.change("indent", false);
      first.current.change("move", false);
      first.current.change("selectionPairs", false);
      first.current.change("wikiCompletion", false);
      first.current.change("tagCompletion", false);
      first.current.change("dateCompletion", false);
    });
    expect(first.current.preferences.smartLists).toEqual({
      continuation: false,
      indent: false,
      move: false,
    });
    expect(first.current.preferences.selectionPairs).toBe(false);
    expect(first.current.preferences.wikiCompletion).toBe(false);
    expect(first.current.preferences.tagCompletion).toBe(false);
    expect(first.current.preferences.dateCompletion).toBe(false);
    expect(JSON.parse(localStorage.getItem(editorPreferenceKey)!)).toEqual(
      first.current.preferences,
    );
    const second = await mounted();
    try {
      expect(second.current.preferences).toEqual(first.current.preferences);
      localStorage.setItem(
        editorPreferenceKey,
        JSON.stringify(defaultEditorPreferences),
      );
      await act(async () =>
        window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" })),
      );
      expect(second.current.preferences.smartLists.move).toBe(false);
      await act(async () =>
        window.dispatchEvent(
          new StorageEvent("storage", { key: editorPreferenceKey }),
        ),
      );
      expect(second.current.preferences).toEqual(defaultEditorPreferences);
      localStorage.removeItem(editorPreferenceKey);
      await act(async () =>
        window.dispatchEvent(new StorageEvent("storage", { key: null })),
      );
      expect(first.current.preferences).toEqual(defaultEditorPreferences);
    } finally {
      await act(async () => second.root.unmount());
    }
  } finally {
    await act(async () => first.root.unmount());
  }
});

it("works in memory with invalid or unavailable preference storage", async () => {
  localStorage.setItem(editorPreferenceKey, "{");
  const mountedPreferences = await mounted();
  try {
    expect(mountedPreferences.current.preferences).toEqual(
      defaultEditorPreferences,
    );
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
    for (const rule of [
      "continuation",
      "indent",
      "move",
    ] as const satisfies readonly (keyof SmartListPreferences)[]) {
      await act(async () => mountedPreferences.current.change(rule, false));
      expect(mountedPreferences.current.preferences.smartLists[rule]).toBe(
        false,
      );
    }
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    await act(async () =>
      window.dispatchEvent(
        new StorageEvent("storage", { key: editorPreferenceKey }),
      ),
    );
    expect(mountedPreferences.current.preferences).toEqual(
      defaultEditorPreferences,
    );
  } finally {
    await act(async () => mountedPreferences.root.unmount());
  }
});
