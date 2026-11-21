import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WindowDragRegion, WindowTitleBar, type WindowChrome } from "../src/browser/WindowTitleBar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function chrome(platform: WindowChrome["platform"] = "windows"): WindowChrome {
  return { platform, maximized: false, minimize: vi.fn(), maximize: vi.fn(), close: vi.fn(), startDragging: vi.fn() };
}

async function render(windowControls: false | WindowChrome) {
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host);
  await act(async () => root.render(createElement(WindowTitleBar, { windowControls, children: [
    createElement("button", { key: "action" }, "Sheet action"),
    createElement(WindowDragRegion, { key: "drag", windowControls }),
  ] })));
  return { host, dispose: async () => { await act(async () => root.unmount()); host.remove(); } };
}

it("keeps the browser header free of native controls and drag regions", async () => {
  const app = await render(false);
  try {
    expect(app.host.querySelector("header")?.className).toBe("workspaceHeader");
    expect(app.host.querySelector("header")?.getAttribute("data-window-controls")).toBe("false");
    expect(app.host.querySelector(".nativeWindowControls, .nativeTitlebarDrag")).toBeNull();
  } finally { await app.dispose(); }
});

it("uses native macOS traffic-light space without drawing duplicate window controls", async () => {
  const app = await render(chrome("mac"));
  try {
    expect(app.host.querySelector("header")?.dataset.nativePlatform).toBe("mac");
    expect(app.host.querySelector("header")?.dataset.windowControls).toBe("false");
    expect(app.host.querySelector(".nativeWindowControls")).toBeNull();
    expect(app.host.querySelector(".nativeTitlebarDrag")).not.toBeNull();
  } finally { await app.dispose(); }
});

it.each(["windows", "linux"] as const)("wires all %s controls and advertises the restore state", async (platform) => {
  const actions = { ...chrome(platform), maximized: true }, app = await render(actions);
  try {
    for (const [name, callback] of [["Minimize", actions.minimize], ["Restore window", actions.maximize], ["Close window", actions.close]] as const) {
      const button = app.host.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!;
      expect(button.title).toBe(name); await act(async () => button.click()); expect(callback).toHaveBeenCalledOnce();
    }
  } finally { await app.dispose(); }
});

it("drags only the empty region with the primary button and maximizes on double click", async () => {
  const actions = chrome(), app = await render(actions);
  try {
    const drag = app.host.querySelector(".nativeTitlebarDrag")!;
    await act(async () => {
      app.host.querySelector("button")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1 }));
      drag.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 2, detail: 1 }));
    });
    expect(actions.startDragging).not.toHaveBeenCalled();
    await act(async () => drag.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1 })));
    expect(actions.startDragging).toHaveBeenCalledOnce();
    await act(async () => drag.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 2 })));
    expect(actions.maximize).toHaveBeenCalledOnce();
  } finally { await app.dispose(); }
});
