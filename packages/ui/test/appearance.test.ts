import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AppearanceControl, useAppearance } from "../src/appearance";

const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("follows system changes, remembers an explicit choice and ignores system changes after it", async () => {
  const media = new EventTarget();
  let dark = true;
  Object.defineProperty(media, "matches", { get: () => dark });
  vi.stubGlobal("matchMedia", () => media);
  const host = document.createElement("div");
  const root = createRoot(host);
  function Controls() {
    const appearance = useAppearance();
    return createElement(AppearanceControl, { preference: appearance.preference, onChange: appearance.change });
  }
  try {
    await act(async () => root.render(createElement(Controls)));
    expect(document.documentElement.dataset.theme).toBe("dark");
    dark = false;
    await act(async () => { media.dispatchEvent(new Event("change")); });
    expect(document.documentElement.dataset.theme).toBe("light");
    const select = host.querySelector("select")!;
    await act(async () => { select.value = "dark"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("slate.appearance")).toBe("dark");
    await act(async () => { media.dispatchEvent(new Event("change")); });
    expect(document.documentElement.dataset.theme).toBe("dark");
    await act(async () => root.unmount());
    const reopened = createRoot(host);
    await act(async () => reopened.render(createElement(Controls)));
    expect(host.querySelector("select")?.value).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--bg-canvas")).toBe("#1B1B1A");
    await act(async () => reopened.unmount());
  } finally { host.remove(); }
});
