import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createMemoryFiles } from "@slate/storage/browser-files";
import { createWorkspaceStore } from "../src/browser/workspaceStore";
import { useNativeFileInfo, type NativeFileModel } from "../src/browser/useNativeFileInfo";
import type { WorkspaceFileActions, WorkspaceFileInfo } from "../src/browser/workspaceRuntime";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: { root: Root; host: HTMLElement }[] = [];
afterEach(async () => { for (const item of roots.splice(0)) { await act(async () => item.root.unmount()); item.host.remove(); } localStorage.clear(); vi.restoreAllMocks(); });
const info = (path: string): WorkspaceFileInfo => ({ absolutePath: `C:\\Notes\\${path}`, bytes: 17, modifiedAt: 1795161600000, revealLabel: "Show in Explorer" });
async function mount(actions?: WorkspaceFileActions) {
  const files = createMemoryFiles({ "a.md": "# Alpha", "b.md": "# Beta" }), write = vi.spyOn(files, "write");
  const store = createWorkspaceStore({ id: "sample", name: "Notes", tier: "library" }, files); await store.load(); store.setOwned(false);
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host); roots.push({ root, host });
  let model: NativeFileModel | undefined;
  function Probe({ path }: { path: string }) { model = useNativeFileInfo(store, path, actions); return createElement("p", {}, model?.info?.absolutePath ?? "pending"); }
  const render = async (path: string) => { await act(async () => root.render(createElement(Probe, { path }))); };
  await render("a.md"); return { host, store, write, render, model: () => model };
}

it("exposes no file-manager action in a browser and performs no writes for a native reader", async () => {
  const browser = await mount(); expect(browser.model()).toBeUndefined(); expect(browser.write).not.toHaveBeenCalled();
  const actions = { info: vi.fn(async (path: string) => info(path)), reveal: vi.fn(async () => undefined) };
  const reader = await mount(actions); expect(reader.model()?.info).toEqual(info("a.md"));
  await act(async () => reader.model()!.reveal()); expect(actions.reveal).toHaveBeenCalledExactlyOnceWith("a.md");
  expect(reader.store.api.getState().owned).toBe(false); expect(reader.write).not.toHaveBeenCalled();
});

it("ignores stale file metadata after navigation and coalesces repeated reveal clicks", async () => {
  let first: (value: WorkspaceFileInfo) => void = () => { throw Error("Missing first request"); };
  let second: (value: WorkspaceFileInfo) => void = () => { throw Error("Missing second request"); };
  let finishReveal: () => void = () => { throw Error("Missing reveal request"); };
  const actions = { info: vi.fn((path: string) => new Promise<WorkspaceFileInfo>(resolve => { if (path === "a.md") first = resolve; else second = resolve; })),
    reveal: vi.fn(() => new Promise<void>(resolve => { finishReveal = resolve; })) };
  const reader = await mount(actions); await reader.render("b.md");
  await act(async () => first(info("a.md"))); expect(reader.host.textContent).toBe("pending");
  await act(async () => second(info("b.md"))); expect(reader.host.textContent).toBe(info("b.md").absolutePath);
  await act(async () => { reader.model()!.reveal(); reader.model()!.reveal(); });
  expect(actions.reveal).toHaveBeenCalledExactlyOnceWith("b.md"); expect(reader.model()?.revealing).toBe(true);
  await act(async () => finishReveal()); expect(reader.model()?.revealing).toBe(false); expect(reader.write).not.toHaveBeenCalled();
});

it("shows recoverable metadata/reveal errors and refreshes when requested", async () => {
  const actions = { info: vi.fn(async (path: string) => info(path)), reveal: vi.fn(async () => undefined) };
  actions.reveal.mockRejectedValueOnce(Error("File manager unavailable"));
  actions.info.mockRejectedValueOnce(Error("Access denied"));
  const reader = await mount(actions); expect(reader.model()?.error).toBe("Access denied");
  await act(async () => reader.model()!.refresh()); expect(reader.model()?.info).toEqual(info("a.md")); expect(reader.model()?.error).toBe("");
  await act(async () => reader.model()!.reveal()); expect(reader.model()?.error).toBe("File manager unavailable"); expect(reader.write).not.toHaveBeenCalled();
  await act(async () => reader.model()!.retry()); expect(actions.reveal).toHaveBeenCalledTimes(2); expect(reader.model()?.error).toBe("");
});
