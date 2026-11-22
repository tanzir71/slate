import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createMemoryFiles } from "@slate/storage/browser-files";
import { createDocumentSession } from "@slate/editor";
import NativeLaunchActions from "../src/native/NativeLaunchActions";
import type { NativeLaunchRequest, NativeLaunchSnapshot, NativeLaunchSource } from "../src/native/nativeLaunchSource";
import { createWorkspaceStore } from "../src/browser/workspaceStore";
import { createEditorDocumentPool } from "../src/browser/editorDocumentPool";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const descriptors = new Map(["showModal", "close"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]));
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterAll(() => { for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor); else Reflect.deleteProperty(HTMLDialogElement.prototype, name); } });
beforeEach(() => { localStorage.clear(); history.replaceState({ kept: true }, "", "/?kept=1"); });
afterEach(() => vi.restoreAllMocks());

function transport(uri: string, phase: NativeLaunchRequest["phase"] = "pending", fileName?: string) {
  let snapshot: NativeLaunchSnapshot = { revision: 0, current: { id: "first", url: uri, phase, ...(fileName ? { fileName } : {}) }, waiting: 0, error: null };
  let receive: ((value: NativeLaunchSnapshot) => void) | undefined;
  let fail: ((cause: unknown) => void) | undefined;
  const queued: NativeLaunchRequest[] = [];
  const commit = (current: NativeLaunchRequest | null) => { snapshot = { ...snapshot, revision: snapshot.revision + 1, current, waiting: queued.length }; receive?.(snapshot); return snapshot; };
  const source = {
    run: vi.fn(async <T>(work: () => Promise<T>) => work()),
    quiesce: vi.fn(async () => () => {}),
    pending: vi.fn(async () => snapshot),
    bind: vi.fn(async (_id: string, spaceId: string) => commit({ ...snapshot.current!, spaceId })),
    begin: vi.fn(async (_id: string, _claim: string) => commit({ ...snapshot.current!, phase: "started" })),
    applied: vi.fn(async (_id: string, _claim: string) => commit({ ...snapshot.current!, phase: "applied" })),
    complete: vi.fn(async (_id: string) => commit(null)),
    review: vi.fn(async (_id: string) => commit({ ...snapshot.current!, phase: "pending" })),
    next: vi.fn(async () => commit(queued.shift() ?? null)),
    resolveFile: vi.fn(async () => ({ space: { id: "native-default", name: "Slate", path: null }, path: "Kept.md", url: "slate://open?space=native-default&path=Kept.md" })),
    listen: vi.fn(async (next: (value: NativeLaunchSnapshot) => void, failed: (cause: unknown) => void) => { receive = next; fail = failed; return () => { receive = undefined; }; }),
  } satisfies NativeLaunchSource;
  return { source, stale: () => receive?.({ revision: 0, current: null, waiting: 0, error: null }), fail: () => fail?.(new Error("Event unavailable")), enqueue: (url: string) => { queued.push({ id: "next", url, phase: "pending" }); commit(snapshot.current); }, snapshot: () => snapshot };
}
async function setup(uri: string, phase: NativeLaunchRequest["phase"] = "pending", configure?: (source: ReturnType<typeof transport>["source"]) => void, fileName?: string) {
  const native = transport(uri, phase, fileName);
  configure?.(native.source);
  const files = createMemoryFiles({ "Kept.md": "\uFEFFOriginal\r\n", "Other.md": "Other words." });
  const store = createWorkspaceStore({ id: "native-default", name: "Slate", tier: "folder" }, files);
  await store.load(); store.setOwned(true);
  const pool = createEditorDocumentPool(store); pool.connect();
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host);
  const onSearch = vi.fn(), onTemplate = vi.fn(async () => {}), onSwitchSpace = vi.fn(async () => {}), onOpenNativeSpace = vi.fn(async () => {});
  const props = { source: native.source, store, pool, onSearch, onTemplate, onSwitchSpace, onOpenNativeSpace, onTakeover: vi.fn(async () => {}), onDialogChange: vi.fn(), onNavigate: vi.fn(), templatesReady: true };
  await act(async () => root.render(createElement(NativeLaunchActions, props)));
  const click = async (label: string) => {
    const button = [...host.querySelectorAll("button")].find(item => item.textContent === label); expect(button, label).toBeDefined();
    await act(async () => button!.click());
  };
  return { ...native, files, store, pool, host, click, onSearch, onTemplate, onSwitchSpace, onOpenNativeSpace, onNavigate: props.onNavigate,
    remount: async (nextStore = store, nextPool = pool) => { await act(async () => root.render(createElement(NativeLaunchActions, { ...props, store: nextStore, pool: nextPool, key: "reloaded" }))); },
    dispose: async () => { await act(async () => root.unmount()); pool.dispose(); host.remove(); },
  };
}

it("opens an OS file from its host ticket without imports, note writes or browser URL changes", async () => {
  const app = await setup("", "pending", undefined, "Kept.md");
  try {
    await vi.waitFor(() => expect(app.source.complete).toHaveBeenCalledOnce());
    expect(app.source.resolveFile).toHaveBeenCalledExactlyOnceWith("first");
    expect(app.source.bind).not.toHaveBeenCalled();
    expect(app.store.api.getState().selectedPath).toBe("Kept.md");
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(await app.files.read("Kept.md"))).toBe("\uFEFFOriginal\r\n");
    expect(await app.files.list()).toEqual(["Kept.md", "Other.md"]);
    expect(location.search).toBe("?kept=1");
  } finally { await app.dispose(); }
});

it("retains a failed OS file ticket for retry without falling back to another note", async () => {
  const app = await setup("", "pending", source => source.resolveFile.mockRejectedValueOnce(Error("Original folder disconnected")), "Kept.md");
  try {
    expect(app.host.textContent).toContain("Original folder disconnected");
    expect(app.source.begin).not.toHaveBeenCalled(); expect(app.source.complete).not.toHaveBeenCalled();
    await app.click("Try again");
    expect(app.source.resolveFile).toHaveBeenCalledTimes(2); expect(app.source.complete).toHaveBeenCalledOnce();
  } finally { await app.dispose(); }
});

it("switches to the admitted native Space before opening the same ticket there", async () => {
  const space = { id: "12345678-1234-4321-9876-123456789abc", name: "Folder notes", path: "C:\\Notes" };
  const app = await setup("", "pending", source => source.resolveFile.mockResolvedValue({ space, path: "Notebook/target.md", url: `slate://open?space=${space.id}&path=Notebook%2Ftarget.md` }), "target.md");
  const files = createMemoryFiles({ "Notebook/target.md": "\uFEFFExact\r\n" });
  const store = createWorkspaceStore({ id: space.id, name: space.name, tier: "folder" }, files);
  await store.load(); store.setOwned(true); const pool = createEditorDocumentPool(store); pool.connect();
  try {
    expect(app.onOpenNativeSpace).toHaveBeenCalledExactlyOnceWith(space);
    expect(app.source.begin).not.toHaveBeenCalled();
    await app.remount(store, pool);
    await vi.waitFor(() => expect(app.source.complete).toHaveBeenCalledOnce());
    expect(store.api.getState().selectedPath).toBe("Notebook/target.md");
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(await files.read("Notebook/target.md"))).toBe("\uFEFFExact\r\n");
  } finally { await app.dispose(); pool.dispose(); }
});

it("retries completion of an opened OS file without reopening it", async () => {
  const app = await setup("", "pending", source => source.complete.mockRejectedValueOnce(Error("Finish unavailable")), "Kept.md");
  try {
    expect(app.host.textContent).toContain("Finish unavailable");
    await app.click("Finish request");
    expect(app.onNavigate).toHaveBeenCalledOnce(); expect(app.source.resolveFile).toHaveBeenCalledOnce();
  } finally { await app.dispose(); }
});
it("confirms native creation without touching browser URL state and cancels without writes", async () => {
  const app = await setup("slate://new?title=Native&text=%EF%BB%BFNew%0D%0A");
  try {
    expect(await app.files.list()).toEqual(["Kept.md", "Other.md"]);
    await app.click("Continue");
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(await app.files.read("Inbox/Native.md"))).toBe("\uFEFFNew\r\n");
    expect(app.source.begin).toHaveBeenCalledOnce(); expect(app.source.applied).toHaveBeenCalledOnce(); expect(app.source.complete).toHaveBeenCalledOnce();
    expect(location.search).toBe("?kept=1"); expect(history.state).toEqual({ kept: true });
  } finally { await app.dispose(); }
  const cancelled = await setup("slate://new?title=Cancelled&text=No");
  try { await cancelled.click("Cancel"); expect(await cancelled.files.list()).toEqual(["Kept.md", "Other.md"]); expect(cancelled.source.begin).not.toHaveBeenCalled(); }
  finally { await cancelled.dispose(); }
});
it.each(["complete", "applied"] as const)("retries failed %s after append without repeating its bytes or Undo entry", async method => {
  const app = await setup("slate://append?path=Kept.md&text=Added%0Awords");
  try {
    app.source[method].mockRejectedValueOnce(new Error("Finish unavailable"));
    await app.click("Continue");
    const expected = "\uFEFFOriginal\r\n\r\nAdded\r\nwords";
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(await app.files.read("Kept.md"))).toBe(expected);
    expect(app.host.querySelector('[role="alert"]')?.textContent).toBe("Finish unavailable");
    await app.click("Finish request");
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(await app.files.read("Kept.md"))).toBe(expected);
    expect(app.source.begin).toHaveBeenCalledOnce();
    const document = app.pool.get("Kept.md", createDocumentSession)!;
    expect(document.undo()).toBe(true); await app.store.flush();
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(await app.files.read("Kept.md"))).toBe("\uFEFFOriginal\r\n");
    expect(document.undo()).toBe(false);
  } finally { await app.dispose(); }
});
it("does not create a collision copy when native completion fails after a successful new sheet", async () => {
  const app = await setup("slate://new?title=Once&text=One");
  try {
    app.source.complete.mockRejectedValueOnce(new Error("Finish unavailable"));
    await app.click("Continue"); await app.click("Finish request");
    expect((await app.files.list()).filter(path => path.startsWith("Inbox/"))).toEqual(["Inbox/Once.md"]);
    expect(app.source.begin).toHaveBeenCalledOnce();
  } finally { await app.dispose(); }
});
it("keeps queued requests behind explicit review and rejects an older snapshot", async () => {
  const app = await setup("slate://new?title=First");
  try {
    await act(async () => app.enqueue("slate://new?title=Second"));
    await act(async () => app.stale());
    expect(app.host.querySelector<HTMLInputElement>('[aria-label="Title"]')?.value).toBe("First");
    expect(app.host.textContent).toContain("1 incoming request waiting");
    await app.click("Cancel"); expect(app.host.querySelector("dialog")).toBeNull();
    await app.click("Review next request"); expect(app.host.querySelector<HTMLInputElement>('[aria-label="Title"]')?.value).toBe("Second");
  } finally { await app.dispose(); }
});
it("retains wrong-Space requests across remounts without granting folder access or starting writes", async () => {
  const app = await setup("slate://append?space=other&path=Kept.md&text=No");
  try {
    await app.click("Switch Space"); await app.remount();
    expect(app.host.textContent).toContain("This link targets another Space"); expect(app.onSwitchSpace).toHaveBeenCalledOnce();
    expect(app.host.querySelector<HTMLTextAreaElement>('[aria-label="Text to append"]')?.disabled).toBe(true);
    expect(app.source.begin).not.toHaveBeenCalled(); expect(app.source.complete).not.toHaveBeenCalled();
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(await app.files.read("Kept.md"))).toBe("\uFEFFOriginal\r\n");
  } finally { await app.dispose(); }
});
it("requires review for an interrupted request and only finishes a request already marked applied", async () => {
  const interrupted = await setup("slate://append?path=Kept.md&text=Added", "started");
  try {
    expect(interrupted.host.textContent).toContain("It may already have changed a sheet"); expect(interrupted.source.begin).not.toHaveBeenCalled();
    await interrupted.click("Review again"); await interrupted.click("Continue"); expect(interrupted.source.begin).toHaveBeenCalledOnce();
  } finally { await interrupted.dispose(); }
  const applied = await setup("slate://append?path=Kept.md&text=Added", "applied");
  try { expect(applied.source.complete).toHaveBeenCalledOnce(); expect(applied.source.begin).not.toHaveBeenCalled(); expect(applied.source.applied).not.toHaveBeenCalled(); expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(await applied.files.read("Kept.md"))).toBe("\uFEFFOriginal\r\n"); }
  finally { await applied.dispose(); }
});
it("retains the first reviewed Space for an unscoped URI across a Space remount", async () => {
  const app = await setup("slate://append?path=Kept.md&text=Added");
  const otherFiles = createMemoryFiles({ "Kept.md": "Other Space words" });
  const other = createWorkspaceStore({ id: "other", name: "Other", tier: "folder" }, otherFiles);
  await other.load(); other.setOwned(true); const pool = createEditorDocumentPool(other); pool.connect();
  try {
    expect(app.snapshot().current?.spaceId).toBe("native-default");
    await app.remount(other, pool);
    expect(app.host.textContent).toContain("This link targets another Space");
    expect(app.source.bind).toHaveBeenCalledExactlyOnceWith("first", "native-default");
    expect(app.source.begin).not.toHaveBeenCalled(); expect(new TextDecoder().decode(await otherFiles.read("Kept.md"))).toBe("Other Space words");
  } finally { await app.dispose(); pool.dispose(); }
});
it("runs native open, search and template read flows", async () => {
  const opened = await setup("slate://open?path=Other.md");
  try { expect(opened.store.api.getState().selectedPath).toBe("Other.md"); expect(opened.source.complete).toHaveBeenCalledOnce(); }
  finally { await opened.dispose(); }
  const search = await setup("slate://search?query=literal");
  try { expect(search.onSearch).toHaveBeenCalledExactlyOnceWith("literal"); }
  finally { await search.dispose(); }
  const template = await setup("slate://new?template=Daily&title=Linked");
  try { expect(template.onTemplate).toHaveBeenCalledExactlyOnceWith({ template: "Daily", title: "Linked", notebook: undefined, text: undefined }); expect((await template.files.list()).length).toBe(2); }
  finally { await template.dispose(); }
});
it("does not repeat search navigation after a failed native completion", async () => {
  const app = await setup("slate://search?query=literal", "pending", source => { source.complete.mockRejectedValueOnce(new Error("Finish unavailable")); });
  try {
    expect(app.onSearch).toHaveBeenCalledExactlyOnceWith("literal"); expect(app.host.textContent).toContain("Finish unavailable");
    await app.click("Finish request"); expect(app.onSearch).toHaveBeenCalledExactlyOnceWith("literal");
  } finally { await app.dispose(); }
});
it("reuses its claim after a lost start reply without writing before the retry", async () => {
  const app = await setup("slate://new?title=Claimed&text=One", "pending", source => {
    const begin = source.begin.getMockImplementation()!;
    source.begin.mockImplementationOnce(async (id, claim) => { await begin(id, claim); throw Error("Reply unavailable"); });
  });
  try {
    await app.click("Continue"); expect((await app.files.list()).length).toBe(2);
    await app.click("Continue"); expect((await app.files.list()).filter(path => path.startsWith("Inbox/"))).toEqual(["Inbox/Claimed.md"]);
    expect(app.source.begin.mock.calls[0]?.[1]).toBe(app.source.begin.mock.calls[1]?.[1]);
  } finally { await app.dispose(); }
});
it("locks confirmation while cancellation is awaiting its native acknowledgement", async () => {
  let release!: () => Promise<void>;
  const app = await setup("slate://new?title=Cancelled", "pending", source => {
    const complete = source.complete.getMockImplementation()!;
    source.complete.mockImplementationOnce(id => new Promise(resolve => { release = async () => { resolve(await complete(id)); }; }));
  });
  try {
    await app.click("Cancel"); await app.click("Saving…");
    expect(app.source.begin).not.toHaveBeenCalled(); expect((await app.files.list()).length).toBe(2);
    await act(async () => release()); expect(app.host.querySelector("dialog")).toBeNull();
  } finally { await app.dispose(); }
});
it("clears a recoverable listener error after reading the same authoritative snapshot", async () => {
  const app = await setup("slate://new?title=Kept");
  try {
    await act(async () => app.fail()); expect(app.host.textContent).toContain("Event unavailable");
    await app.click("Retry desktop links"); expect(app.host.querySelector('[role="alert"]')).toBeNull();
    expect(app.host.querySelector<HTMLInputElement>('[aria-label="Title"]')?.value).toBe("Kept");
  } finally { await app.dispose(); }
});
