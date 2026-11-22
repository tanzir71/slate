import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativeOnboarding } from "../src/native/NativeOnboarding";
import { commandShortcut, readKeymap } from "../src/commands";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const modal = new Map(["showModal", "close"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]));
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterEach(() => { for (const [name, descriptor] of modal) { if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor); else Reflect.deleteProperty(HTMLDialogElement.prototype, name); } });
async function setup() {
  const space = { id: "12345678-1234-4321-9876-123456789abc", name: "Personal", path: "/Documents/Slate/Personal" };
  const catalog = { pick: vi.fn(async () => space), create: vi.fn(async () => space) }, onOpen = vi.fn(async () => {}), onSkip = vi.fn(async () => {});
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host);
  await act(async () => root.render(createElement(NativeOnboarding, { catalog, windowChrome: false, onOpen, onSkip })));
  const click = async (text: string) => { const button = [...host.querySelectorAll("button")].find(button => button.textContent === text); expect(button).toBeDefined(); await act(async () => button!.click()); };
  const choose = async (name: "nativePreset" | "nativeDestination", value: string) => { await act(async () => host.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!.click()); };
  return { host, catalog, onOpen, onSkip, space, click, choose, dispose: async () => { await act(async () => root.unmount()); host.remove(); } };
}
it("opens a picked folder with the selected actual preset, only after Continue", async () => {
  const app = await setup();
  try {
    await app.choose("nativeDestination", "folder"); await app.choose("nativePreset", "researcher");
    expect(app.catalog.pick).not.toHaveBeenCalled(); expect(app.onOpen).not.toHaveBeenCalled();
    await app.click("Continue"); expect(app.onOpen).toHaveBeenCalledExactlyOnceWith(app.space, "researcher", false);
  } finally { await app.dispose(); }
});
it("runs the registry's Open folder binding and excludes that native chord from the browser profile", async () => {
  const app = await setup();
  try {
    const desktop = readKeymap(undefined, "windows", "desktop"), browser = readKeymap(undefined, "windows", "web");
    expect(commandShortcut("space.openFolder", desktop, "windows")).toBe("Ctrl O");
    expect(browser.bindings.some(binding => binding.command.id === "space.openFolder")).toBe(false);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", code: "KeyO", ctrlKey: true, bubbles: true, cancelable: true })));
    expect(app.catalog.pick).toHaveBeenCalledOnce(); expect(app.onOpen).toHaveBeenCalledExactlyOnceWith(app.space, "writer", false);
  } finally { await app.dispose(); }
});
it("blocks duplicate setup work until the pending folder operation finishes", async () => {
  const app = await setup(); let release!: () => void;
  app.onOpen.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  try {
    await app.choose("nativeDestination", "folder"); await app.click("Continue");
    await app.click("Continue"); await app.click("Skip");
    expect(app.catalog.pick).toHaveBeenCalledOnce(); expect(app.onSkip).not.toHaveBeenCalled();
    expect([...app.host.querySelectorAll("input")].every(input => input.matches(":disabled"))).toBe(true);
    await act(async () => release());
  } finally { release?.(); await app.dispose(); }
});
