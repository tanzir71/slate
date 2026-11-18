import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { SmartPasteOptions } from "@slate/editor";
import { useSmartPaste } from "../src/useSmartPaste";

const created = vi.hoisted(() =>
  vi.fn((options: SmartPasteOptions) => [options]),
);
vi.mock("@slate/editor", () => ({ createSmartPaste: created }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => created.mockClear());

it("keeps separate failed pastes, retains a blocked retry and dismisses only an accepted retry", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  let enabled = true;
  let extension: unknown;
  function Reader() {
    const paste = useSmartPaste({
      richText: enabled,
      links: true,
      images: true,
      tables: true,
    });
    extension = paste.extension;
    return paste.notices;
  }
  await act(async () => root.render(createElement(Reader)));
  try {
    const original = extension;
    const options = created.mock.lastCall![0];
    const retry = vi.fn().mockReturnValue(false);
    await act(async () => {
      options.onNotice!({ message: "First paste", retry });
      options.onNotice!({ message: "Second paste" });
    });
    expect(host.textContent).toContain("First paste");
    expect(host.textContent).toContain("Second paste");
    expect(extension).toBe(original);
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(retry).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("First paste");
    retry.mockReturnValue(true);
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(host.textContent).not.toContain("First paste");
    expect(host.textContent).toContain("Second paste");
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(host.textContent).toBe("");
    enabled = false;
    await act(async () => root.render(createElement(Reader)));
    expect(extension).not.toBe(original);
    expect(created.mock.lastCall![0].richText).toBe(false);
  } finally {
    await act(async () => root.unmount());
  }
});
