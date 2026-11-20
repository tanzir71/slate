import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorTabs } from "../src/browser/EditorTabs";
import type { WorkspaceEditorLayout } from "../src/browser/workspaceEditorLayout";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function mount(overrides: Partial<WorkspaceEditorLayout> = {}, label?: (path: string) => string) {
  const layout: WorkspaceEditorLayout = { tabs: ["a.md", "b.md", "c.md"], primary: "a.md", secondary: undefined, active: "primary", ...overrides };
  const onOpen = vi.fn(), onClose = vi.fn(), onNew = vi.fn(), onSplit = vi.fn();
  await act(async () => root.render(createElement(EditorTabs, { layout, dirty: (path) => path === "a.md", onOpen, onClose, onNew, onSplit, ...(label ? { label } : {}) })));
  const tab = (path: string) => host.querySelector<HTMLButtonElement>(`[role="tab"][aria-label="${path}"]`)!;
  return { onOpen, onClose, onNew, onSplit, tab };
}
it("exposes one selected keyboard tab and describes dirty state without changing its file identity", async () => {
  const { tab } = await mount(); expect(host.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Open sheets");
  expect(tab("a.md").getAttribute("aria-selected")).toBe("true"); expect(tab("a.md").tabIndex).toBe(0); expect(tab("b.md").tabIndex).toBe(-1);
  expect(document.getElementById(tab("a.md").getAttribute("aria-describedby")!)?.textContent).toBe("Unsaved changes");
  expect(tab("b.md").hasAttribute("aria-describedby")).toBe(false);
});
it("routes clicks to captured paths and separate open/split controls", async () => {
  const actions = await mount();
  await act(async () => { actions.tab("b.md").click(); host.querySelector<HTMLButtonElement>('[aria-label="Close a.md"]')!.click();
    host.querySelector<HTMLButtonElement>('[aria-label="Open sheet in tab"]')!.click(); host.querySelector<HTMLButtonElement>('[aria-label="Split editor"]')!.click(); });
  expect(actions.onOpen).toHaveBeenCalledExactlyOnceWith("b.md", true); expect(actions.onClose).toHaveBeenCalledExactlyOnceWith("a.md");
  expect(actions.onNew).toHaveBeenCalledTimes(1); expect(actions.onSplit).toHaveBeenCalledTimes(1);
});
it.each([["ArrowRight", "b.md"], ["ArrowLeft", "c.md"], ["Home", "a.md"], ["End", "c.md"]])("moves tab focus with %s", async (key, path) => {
  const { tab, onOpen } = await mount(); const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => { tab("a.md").dispatchEvent(event); });
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(path, false); expect(document.activeElement).toBe(tab(path)); expect(event.defaultPrevented).toBe(true);
});
it("keeps browser shortcuts and composing keys outside tab navigation", async () => {
  const { tab, onOpen } = await mount();
  for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
    const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true, ...init });
    await act(async () => { tab("a.md").dispatchEvent(event); }); expect(event.defaultPrevented).toBe(false);
  }
  expect(onOpen).not.toHaveBeenCalled();
});
it("offers closing an existing split and disables creating a split from an empty editor", async () => {
  await mount({ tabs: [], primary: "" }); expect(host.querySelector<HTMLButtonElement>('[aria-label="Split editor"]')!.disabled).toBe(true);
  await mount({ secondary: "b.md", active: "secondary" }); expect(host.querySelector('[aria-label="Close split"]')?.getAttribute("aria-pressed")).toBe("true");
});

it("shows a note's reader title while retaining its exact file identity for actions", async () => {
  const { tab, onOpen } = await mount({}, () => "Alpha report");
  expect(tab("a.md").querySelector(".editorTabLabel")?.textContent).toBe("Alpha report");
  expect(tab("a.md").title).toBe("a.md"); await act(async () => { tab("a.md").click(); });
  expect(onOpen).toHaveBeenCalledExactlyOnceWith("a.md", true);
});
