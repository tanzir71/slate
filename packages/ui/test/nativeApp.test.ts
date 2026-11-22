import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryFiles } from "@slate/storage/browser-files";
import { createNativeWorkspace, type NativeLifecycle } from "../src/native/nativeWorkspace";
import { NativeApp } from "../src/native/NativeApp";
import { defaultNativeSpace, type NativeSpace } from "../src/native/nativeSpaces";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../src/browser/BrowserWorkspace", () => ({ default: ({ store, onSwitchSpace, initialImport }: { store: ReturnType<typeof createNativeWorkspace>["store"]; onSwitchSpace(): Promise<void>; initialImport?: boolean }) =>
  createElement("main", { "data-initial-import": String(initialImport) }, createElement("p", { "data-space": store.api.getState().record.id }, store.api.getState().sheets[0]?.content), createElement("button", { onClick: () => { void onSwitchSpace(); } }, "Switch Space")),
}));
const folder: NativeSpace = { id: "12345678-1234-4321-9876-123456789abc", name: "Chosen", path: "/Chosen" };
const modal = new Map(["showModal", "close"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]));
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const [name, descriptor] of modal) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});
function makeSession(space: NativeSpace, content: string) {
  const stop = vi.fn();
  const lifecycle: NativeLifecycle = { listen: vi.fn(async () => stop), watchStatus: vi.fn(async () => []), onClose: vi.fn(async () => stop), destroy: vi.fn(async () => {}) };
  const files = createMemoryFiles({ "same.md": content });
  return { ...createNativeWorkspace(lifecycle, files, createMemoryFiles(), space), files, lifecycle, stop };
}
async function setup(failedStartup = false, fresh = false) {
  const first = makeSession(defaultNativeSpace, "First words"), second = makeSession(folder, "Second words");
  const createSession = vi.fn(async (space = defaultNativeSpace) => space.id === folder.id ? second : first);
  if (failedStartup) createSession.mockRejectedValueOnce(Error("Remembered folder disconnected"));
  const catalog = { list: vi.fn(async () => [defaultNativeSpace, folder]), pick: vi.fn(async (): Promise<NativeSpace | null> => folder), create: vi.fn(async () => folder), startup: vi.fn(async () => null), remember: vi.fn(async (id: string) => id === folder.id ? folder : defaultNativeSpace) };
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host);
  await act(async () => root.render(createElement(NativeApp, { createSession, catalog, resolveStartup: async () => fresh ? null : defaultNativeSpace })));
  const click = async (label: string) => {
    const button = [...host.querySelectorAll("button")].find(item => item.textContent === label || item.querySelector("strong")?.textContent === label);
    expect(button, label).toBeDefined(); await act(async () => button!.click());
  };
  if (!failedStartup && !fresh) await vi.waitFor(() => expect(host.querySelector("[data-space]")).not.toBeNull());
  return { first, second, createSession, catalog, host, click, dispose: async () => { await act(async () => root.unmount()); host.remove(); } };
}
it("flushes the old Space and loads the chosen folder before swapping close protection", async () => {
  const app = await setup();
  try {
    app.first.store.edit("Pending first draft");
    await app.click("Switch Space"); await app.click("Chosen");
    expect(app.host.querySelector("[data-space]")?.getAttribute("data-space")).toBe(folder.id);
    expect(app.host.querySelector("main")?.textContent).toContain("Second words");
    expect(new TextDecoder().decode(await app.first.files.read("same.md"))).toBe("Pending first draft");
    expect(new TextDecoder().decode(await app.second.files.read("same.md"))).toBe("Second words");
    expect(app.first.stop).toHaveBeenCalledOnce(); expect(app.second.stop).not.toHaveBeenCalled();
    expect(app.host.querySelector("dialog")).toBeNull();
  } finally { await app.dispose(); }
  expect(app.second.stop).toHaveBeenCalledOnce(); expect(app.first.stop).toHaveBeenCalledOnce();
});
it("shows full first run before creating a session, then installs Writer libraries in the explicitly created Space", async () => {
  const app = await setup(false, true);
  try {
    expect(app.host.querySelector("h1")?.textContent).toBe("Where should your writing live?");
    expect(app.createSession).not.toHaveBeenCalled(); expect(app.catalog.remember).not.toHaveBeenCalled();
    expect(app.host.querySelectorAll('input[name="nativeDestination"]')).toHaveLength(3); expect(app.host.querySelectorAll('input[name="nativePreset"]')).toHaveLength(5);
    await app.click("Continue"); await app.click("Create Space");
    await vi.waitFor(() => expect(app.host.querySelector("[data-space]")?.getAttribute("data-space")).toBe(folder.id));
    expect(app.catalog.create).toHaveBeenCalledOnce(); expect(app.catalog.remember).toHaveBeenCalledExactlyOnceWith(folder.id);
    expect(await app.second.files.read(".slate/templates/Writer - Draft.md")).toBeDefined();
    expect(await app.second.files.read(".slate/blocks/Writing review.md")).toBeDefined(); expect(await app.second.files.read(".slate/snippets.json")).toBeDefined();
    expect(new TextDecoder().decode(await app.first.files.read("same.md"))).toBe("First words");
  } finally { await app.dispose(); }
});
it("Skip opens the managed Space without adding any preset library files", async () => {
  const app = await setup(false, true);
  try {
    await app.click("Skip"); await vi.waitFor(() => expect(app.host.querySelector("[data-space]")).not.toBeNull());
    expect(app.catalog.create).not.toHaveBeenCalled(); expect(app.catalog.pick).not.toHaveBeenCalled();
    expect(await app.first.files.list(true)).toEqual(["same.md"]); expect(app.catalog.remember).toHaveBeenCalledExactlyOnceWith(defaultNativeSpace.id);
  } finally { await app.dispose(); }
});
it("an import destination opens the actual workspace with the import handoff enabled", async () => {
  const app = await setup(false, true);
  try {
    await act(async () => app.host.querySelector<HTMLInputElement>('input[name="nativeDestination"][value="import"]')!.click());
    await app.click("Continue"); expect(app.host.querySelector('dialog[aria-label="Import into a new Space"]')).not.toBeNull();
    await app.click("Create Space"); await vi.waitFor(() => expect(app.host.querySelector('[data-initial-import="true"]')).not.toBeNull());
    expect(app.catalog.remember).toHaveBeenCalledExactlyOnceWith(folder.id);
  } finally { await app.dispose(); }
});
it("cancelling Open folder keeps first run and leaves notes and selections untouched", async () => {
  const app = await setup(false, true);
  try {
    app.catalog.pick.mockResolvedValueOnce(null);
    await act(async () => app.host.querySelector<HTMLInputElement>('input[name="nativeDestination"][value="folder"]')!.click());
    await app.click("Continue"); expect(app.createSession).not.toHaveBeenCalled(); expect(app.catalog.remember).not.toHaveBeenCalled();
    expect(app.host.querySelector("h1")?.textContent).toBe("Where should your writing live?");
  } finally { await app.dispose(); }
});
it("retries a partially installed first-run kit using the same session and preserves edited additions", async () => {
  const app = await setup(false, true), write = app.second.files.write;
  let fail = true;
  app.second.files.write = async (path, bytes) => { if (path.startsWith(".slate/blocks/") && fail) throw Error("Starter disk unavailable"); await write(path, bytes); };
  try {
    await app.click("Continue"); await app.click("Create Space");
    expect(app.host.querySelector('[role="alert"]')?.textContent).toContain("Starter disk unavailable");
    expect(app.catalog.remember).not.toHaveBeenCalled(); expect(app.second.stop).toHaveBeenCalledOnce();
    const path = ".slate/templates/Writer - Draft.md"; await write(path, new TextEncoder().encode("Edited after the interrupted setup"));
    fail = false; await app.click("Open Space"); await vi.waitFor(() => expect(app.host.querySelector("[data-space]")).not.toBeNull());
    expect(app.catalog.create).toHaveBeenCalledOnce(); expect(app.createSession).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(await app.second.files.read(path))).toBe("Edited after the interrupted setup");
    expect(app.catalog.remember).toHaveBeenCalledExactlyOnceWith(folder.id);
  } finally { await app.dispose(); }
});

it("keeps the live Space and its Close guard if remembering a new Space fails", async () => {
  const app = await setup();
  try {
    app.first.store.edit("Pending first draft");
    app.catalog.remember.mockRejectedValueOnce(Error("Selection could not be saved"));
    await app.click("Switch Space"); await app.click("Chosen");
    expect(app.host.querySelector('[role="alert"]')?.textContent).toBe("Selection could not be saved");
    expect(app.host.querySelector("[data-space]")?.getAttribute("data-space")).toBe(defaultNativeSpace.id);
    expect(new TextDecoder().decode(await app.first.files.read("same.md"))).toBe("Pending first draft");
    expect(app.first.stop).not.toHaveBeenCalled(); expect(app.second.stop).toHaveBeenCalledOnce();
    await app.click("Chosen");
    expect(app.host.querySelector("[data-space]")?.getAttribute("data-space")).toBe(folder.id);
    expect(app.catalog.remember).toHaveBeenLastCalledWith(folder.id);
  } finally { await app.dispose(); }
});

it("recovers a failed remembered startup through an explicit Space choice without loading a default", async () => {
  const app = await setup(true);
  try {
    expect(app.host.querySelector('[role="alert"]')?.textContent).toBe("Remembered folder disconnected");
    expect(app.first.lifecycle.onClose).not.toHaveBeenCalled(); expect(app.catalog.remember).not.toHaveBeenCalled();
    await app.click("Choose a Space");
    expect(app.host.querySelector('[aria-current="true"]')).toBeNull();
    await app.click("Chosen");
    await vi.waitFor(() => expect(app.host.querySelector("[data-space]")?.getAttribute("data-space")).toBe(folder.id));
    expect(app.createSession).toHaveBeenNthCalledWith(2, folder);
    expect(app.first.lifecycle.onClose).not.toHaveBeenCalled(); expect(app.catalog.remember).toHaveBeenCalledExactlyOnceWith(folder.id);
  } finally { await app.dispose(); }
});
it("keeps the current session and close guard after a folder fails to load, then allows retry", async () => {
  const app = await setup();
  try {
    const open = vi.spyOn(app.second, "open").mockRejectedValueOnce(new Error("Folder disconnected"));
    await app.click("Switch Space"); await app.click("Open a folder");
    expect(app.host.querySelector('[role="alert"]')?.textContent).toBe("Folder disconnected");
    expect(app.host.querySelector("[data-space]")?.getAttribute("data-space")).toBe(defaultNativeSpace.id);
    expect(app.first.stop).not.toHaveBeenCalled(); expect(app.second.lifecycle.onClose).not.toHaveBeenCalled();
    await app.click("Open a folder");
    expect(open).toHaveBeenCalledTimes(2);
    expect(app.host.querySelector("[data-space]")?.getAttribute("data-space")).toBe(folder.id);
  } finally { await app.dispose(); }
});
it("does not open another folder after a failed current-Space flush", async () => {
  const app = await setup();
  try {
    await app.click("Switch Space");
    vi.spyOn(app.first.store, "flush").mockRejectedValueOnce(new Error("Disk is read-only"));
    await app.click("Chosen");
    expect(app.host.querySelector('[role="alert"]')?.textContent).toBe("Disk is read-only");
    expect(app.createSession).toHaveBeenCalledTimes(1); expect(app.first.stop).not.toHaveBeenCalled();
  } finally { await app.dispose(); }
});
it("cancels a native picker without changing sessions and shows catalog failures", async () => {
  const app = await setup();
  try {
    app.catalog.pick.mockResolvedValueOnce(null);
    await app.click("Switch Space"); await app.click("Open a folder");
    expect(app.createSession).toHaveBeenCalledTimes(1); expect(app.host.querySelector("dialog")).not.toBeNull();
    await app.click("Slate");
    app.catalog.list.mockRejectedValueOnce(new Error("Catalog invalid; files kept"));
    await app.click("Switch Space");
    expect(app.host.querySelector('[role="alert"]')?.textContent).toBe("Catalog invalid; files kept");
    expect(app.host.querySelector("[data-space]")?.getAttribute("data-space")).toBe(defaultNativeSpace.id);
  } finally { await app.dispose(); }
});

it("creates a Documents Space through the same flush, load and close-guard transition", async () => {
  const app = await setup();
  try {
    await app.click("Switch Space"); await app.click("Start a new Space");
    expect(app.host.querySelector<HTMLInputElement>('input[name="spaceName"]')?.value).toBe("Personal");
    app.first.store.edit("Pending words before creation");
    await app.click("Create Space");
    expect(app.catalog.create).toHaveBeenCalledWith("Personal", expect.stringContaining("# Welcome to Slate"));
    expect(new TextDecoder().decode(await app.first.files.read("same.md"))).toBe("Pending words before creation");
    expect(app.host.querySelector("[data-space]")?.getAttribute("data-space")).toBe(folder.id);
    expect(app.catalog.remember).toHaveBeenLastCalledWith(folder.id);
    expect(app.first.stop).toHaveBeenCalledOnce(); expect(app.second.stop).not.toHaveBeenCalled();
  } finally { await app.dispose(); }
});

it("keeps the active Space after a creation error and allows another creation attempt", async () => {
  const app = await setup();
  try {
    app.catalog.create.mockRejectedValueOnce(Error("That folder already exists. Choose another name."));
    await app.click("Switch Space"); await app.click("Start a new Space"); await app.click("Create Space");
    expect(app.host.querySelector('[role="alert"]')?.textContent).toContain("already exists");
    expect(app.host.querySelector<HTMLInputElement>('input[name="spaceName"]')?.disabled).toBe(false);
    expect(app.createSession).toHaveBeenCalledTimes(1); expect(app.first.stop).not.toHaveBeenCalled();
    await app.click("Create Space"); expect(app.catalog.create).toHaveBeenCalledTimes(2);
    expect(app.host.querySelector("[data-space]")?.getAttribute("data-space")).toBe(folder.id);
  } finally { await app.dispose(); }
});

it("retries opening an already created Space without recreating or replacing its folder", async () => {
  const app = await setup();
  try {
    vi.spyOn(app.second, "open").mockRejectedValueOnce(Error("New Space temporarily unavailable"));
    await app.click("Switch Space"); await app.click("Start a new Space"); await app.click("Create Space");
    expect(app.host.querySelector('[role="alert"]')?.textContent).toBe("New Space temporarily unavailable");
    expect(app.host.querySelector<HTMLInputElement>('input[name="spaceName"]')?.disabled).toBe(true);
    expect(app.host.textContent).toContain("Created at /Chosen");
    expect(app.host.querySelector("[data-space]")?.getAttribute("data-space")).toBe(defaultNativeSpace.id);
    expect(app.first.stop).not.toHaveBeenCalled();
    await app.click("Open Space");
    expect(app.catalog.create).toHaveBeenCalledOnce();
    expect(app.host.querySelector("[data-space]")?.getAttribute("data-space")).toBe(folder.id);
  } finally { await app.dispose(); }
});
