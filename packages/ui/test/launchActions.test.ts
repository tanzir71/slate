import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createMemoryFiles } from "@slate/storage/browser-files";
import { LaunchActions } from "../src/browser/LaunchActions";
import { createWorkspaceStore } from "../src/browser/workspaceStore";
import { createEditorDocumentPool } from "../src/browser/editorDocumentPool";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const descriptors = new Map(["showModal", "close"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]));
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterAll(() => {
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});
beforeEach(() => { localStorage.clear(); history.replaceState(null, "", "/"); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
type Delivery = { targetURL?: string; files?: { getFile(): Promise<File> }[] };
async function setup(params: Record<string, string> = {}, owned = true) {
  history.replaceState({ kept: true }, "", "/?" + new URLSearchParams(params));
  const files = createMemoryFiles({ "Kept.md": "Original words." });
  const store = createWorkspaceStore({ id: "sample", name: "Notes", tier: "library" }, files);
  await store.load(); store.setOwned(owned);
  const pool = createEditorDocumentPool(store); pool.connect();
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host);
  let deliver: ((request: Delivery) => void) | undefined;
  vi.stubGlobal("launchQueue", { setConsumer(consumer: (request: Delivery) => void) { deliver = consumer; } });
  const onSearch = vi.fn(), onTemplate = vi.fn(async () => {}), onSwitchSpace = vi.fn(async () => {});
  const onTakeover = vi.fn(async () => { store.setOwned(true); });
  await act(async () => root.render(createElement(LaunchActions, { store, pool, onSearch, onTemplate, onSwitchSpace, onTakeover, onDialogChange: vi.fn(), onNavigate: vi.fn(), templatesReady: true })));
  const click = async (label: string) => {
    const button = [...host.querySelectorAll("button")].find(item => item.textContent === label);
    expect(button, label).toBeDefined();
    await act(async () => button!.click());
  };
  return { files, store, host, click, onSearch, onTemplate, onSwitchSpace, onTakeover,
    deliver: async (request: Delivery) => { await act(async () => deliver!(request)); },
    dispose: async () => { await act(async () => root.unmount()); pool.dispose(); host.remove(); },
  };
}

it("reviews a new link without IO, then creates its exact physical text and preserves URL state", async () => {
  const app = await setup({ action: "new", notebook: "Work", title: "Linked", text: "\uFEFF# Linked\r\n" });
  try {
    expect(await app.files.list()).toHaveLength(1);
    expect(app.host.querySelector<HTMLInputElement>('[aria-label="Title"]')!.value).toBe("Linked");
    await app.click("Continue");
    expect(await app.store.space.read("Work/Linked.md")).toBe("\uFEFF# Linked\r\n");
    expect(await app.store.space.read("Kept.md")).toBe("Original words.");
    expect(app.host.querySelector("dialog")).toBeNull();
    expect(location.search).toBe(""); expect(history.state).toEqual({ kept: true });
  } finally { await app.dispose(); }
});

it("cancels an append without changing the file or history", async () => {
  const app = await setup({ action: "append", path: "Kept.md", text: "Unconfirmed words." });
  try {
    await app.click("Cancel");
    expect(await app.store.space.read("Kept.md")).toBe("Original words.");
    expect(app.host.querySelector("dialog")).toBeNull();
  } finally { await app.dispose(); }
});

it("rejects unsafe destinations before opening or writing a file", async () => {
  const app = await setup({ action: "append", path: "../Kept.md", text: "Unsafe words." });
  try {
    expect(app.host.querySelector('[role="alert"]')).not.toBeNull();
    expect([...app.host.querySelectorAll("button")].find(item => item.textContent === "Continue")!.disabled).toBe(true);
    expect(await app.files.list()).toHaveLength(1);
  } finally { await app.dispose(); }
});

it("opens search with the decoded query without creating a sheet", async () => {
  const app = await setup({ action: "search", query: "café #kept + words" });
  try {
    expect(app.onSearch).toHaveBeenCalledExactlyOnceWith("café #kept + words");
    expect(await app.files.list()).toHaveLength(1);
    expect(app.host.querySelector("dialog")).toBeNull();
  } finally { await app.dispose(); }
});

it("passes human template titles and literal body text to preview without creating a file", async () => {
  const app = await setup({ action: "new", template: "meeting", title: "Review: next", notebook: "Work", text: "{{clipboard}}" });
  try {
    expect(app.onTemplate).toHaveBeenCalledExactlyOnceWith({ template: "meeting", title: "Review: next", notebook: "Work", text: "{{clipboard}}" });
    expect(await app.files.list()).toHaveLength(1);
  } finally { await app.dispose(); }
});

it("blocks another Space instead of silently creating in the current Space", async () => {
  const app = await setup({ action: "new", space: "other", title: "Wrong Space" });
  try {
    expect(app.host.querySelector('[role="alert"]')!.textContent).toContain("another Space");
    await app.click("Continue"); expect(await app.files.list()).toHaveLength(1);
    await app.click("Switch Space"); expect(app.onSwitchSpace).toHaveBeenCalledOnce();
    expect(await app.files.list()).toHaveLength(1);
  } finally { await app.dispose(); }
});

it("requires ownership and explicit confirmation after takeover", async () => {
  const app = await setup({ action: "new", title: "Owned" }, false);
  try {
    await app.click("Continue"); expect(await app.files.list()).toHaveLength(1);
    await app.click("Use here"); expect(app.onTakeover).toHaveBeenCalledOnce();
    expect(await app.files.list()).toHaveLength(1);
    await app.click("Continue"); expect(await app.store.space.read("Inbox/Owned.md")).toBe("");
  } finally { await app.dispose(); }
});

it("ignores the initial URL echo and queues later URLs without replacing reviewed words", async () => {
  const app = await setup({ action: "new", title: "First", text: "First words." });
  try {
    await app.deliver({ targetURL: location.href, files: [] });
    await app.deliver({ targetURL: location.origin + "/?action=new&title=Second&text=Second" });
    await app.deliver({ targetURL: location.origin + "/?action=search&query=Third" });
    expect(app.host.querySelector<HTMLInputElement>('[aria-label="Title"]')!.value).toBe("First");
    expect(app.host.querySelector('[role="status"]')!.textContent).toContain("2 incoming requests");
    await app.click("Continue");
    expect(await app.store.space.read("Inbox/First.md")).toBe("First words.");
    expect(app.host.querySelector("dialog")).toBeNull();
    await app.click("Review next request");
    expect(app.host.querySelector<HTMLInputElement>('[aria-label="Title"]')!.value).toBe("Second");
    await app.click("Cancel"); await app.click("Review next request");
    expect(app.onSearch).toHaveBeenCalledExactlyOnceWith("Third");
    expect(await app.store.space.read("Inbox/Second.md")).toBeUndefined();
  } finally { await app.dispose(); }
});

it("rejects queued URLs outside this app without following them or changing existing words", async () => {
  const app = await setup();
  try {
    await app.deliver({ targetURL: "https://untrusted.example/?action=new&title=Unsafe" });
    expect(app.host.querySelector('[role="alert"]')!.textContent).toContain("this Slate app");
    expect(location.origin).not.toBe("https://untrusted.example");
    expect(await app.files.list()).toHaveLength(1);
  } finally { await app.dispose(); }
});

it("accepts a first installed-app request matching a dismissed original URL", async () => {
  const app = await setup({ action: "new", title: "Again", text: "Keep these incoming words." });
  const targetURL = location.href;
  try {
    await app.click("Cancel");
    expect(app.host.querySelector("dialog")).toBeNull();
    await app.deliver({ targetURL, files: [] });
    expect(app.host.querySelector<HTMLInputElement>('[aria-label="Title"]')?.value).toBe("Again");
    expect(app.host.querySelector<HTMLTextAreaElement>('[aria-label="New sheet text"]')?.value).toBe("Keep these incoming words.");
    expect(await app.files.list()).toHaveLength(1);
  } finally { await app.dispose(); }
});
