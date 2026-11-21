import { expect, it, vi } from "vitest";
import { createNativeWindowChrome, type NativeWindowAPI } from "../src/native/nativeWindow";

function setup() {
  let maximized = false, resize: (() => void) | undefined;
  const stop = vi.fn(), failed = vi.fn();
  const api: NativeWindowAPI = {
    isMaximized: vi.fn(async () => maximized), minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => { maximized = !maximized; }), close: vi.fn(async () => {}),
    startDragging: vi.fn(async () => {}), onResized: vi.fn(async (listener) => { resize = listener; return stop; }),
  };
  const controller = createNativeWindowChrome(api, "windows", failed);
  return { api, controller, stop, failed, resize: (value: boolean) => { maximized = value; resize?.(); } };
}

it("dispatches native minimize, drag and close requests without exposing destroy", async () => {
  const { api, controller, failed } = setup();
  await controller.connect();
  const chrome = controller.getSnapshot();
  chrome.minimize(); chrome.startDragging(); chrome.close();
  await vi.waitFor(() => expect(api.close).toHaveBeenCalledOnce());
  expect(api.minimize).toHaveBeenCalledOnce(); expect(api.startDragging).toHaveBeenCalledOnce();
  expect(chrome).not.toHaveProperty("destroy"); expect(failed).not.toHaveBeenCalled();
  controller.dispose();
});

it("tracks maximize/restore and native resize changes while keeping a stable snapshot", async () => {
  const { api, controller, resize } = setup(), changed = vi.fn();
  const unsubscribe = controller.subscribe(changed);
  await controller.connect();
  const initial = controller.getSnapshot();
  expect(controller.getSnapshot()).toBe(initial);
  initial.maximize();
  await vi.waitFor(() => expect(controller.getSnapshot().maximized).toBe(true));
  expect(api.toggleMaximize).toHaveBeenCalledOnce();
  resize(false);
  await vi.waitFor(() => expect(controller.getSnapshot().maximized).toBe(false));
  expect(changed).toHaveBeenCalledTimes(2);
  unsubscribe(); controller.dispose();
});

it("ignores a stale maximized reply after a newer native resize", async () => {
  const { api, controller, resize } = setup();
  let finish!: (value: boolean) => void;
  vi.mocked(api.isMaximized).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const connecting = controller.connect();
  await vi.waitFor(() => expect(api.isMaximized).toHaveBeenCalledOnce());
  resize(true);
  await vi.waitFor(() => expect(controller.getSnapshot().maximized).toBe(true));
  finish(false); await connecting;
  expect(controller.getSnapshot().maximized).toBe(true);
  controller.dispose();
});

it("removes a resize listener that finishes registering after disposal", async () => {
  const { api, controller, stop } = setup();
  let finish!: (off: () => void) => void;
  vi.mocked(api.onResized).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const connecting = controller.connect(); controller.dispose(); finish(stop); await connecting;
  expect(stop).toHaveBeenCalledOnce(); expect(api.isMaximized).not.toHaveBeenCalled();
  controller.getSnapshot().close(); expect(api.close).not.toHaveBeenCalled();
});

it("connects once and releases the native listener on disposal", async () => {
  const { api, controller, stop, resize } = setup(), changed = vi.fn();
  controller.subscribe(changed);
  await controller.connect(); await controller.connect();
  expect(api.onResized).toHaveBeenCalledOnce();
  controller.dispose(); controller.dispose(); resize(true);
  expect(stop).toHaveBeenCalledOnce(); expect(changed).not.toHaveBeenCalled();
  expect(api.isMaximized).toHaveBeenCalledOnce();
});

it("reports native action errors without rejecting UI event handlers", async () => {
  const { api, controller, failed } = setup();
  await controller.connect();
  const denied = new Error("Minimize unavailable");
  vi.mocked(api.minimize).mockRejectedValue(denied);
  expect(controller.getSnapshot().minimize()).toBeUndefined();
  await vi.waitFor(() => expect(failed).toHaveBeenCalledWith(denied));
  vi.mocked(api.toggleMaximize).mockRejectedValue(new Error("Maximize unavailable"));
  controller.getSnapshot().maximize();
  await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(2));
  controller.dispose();
});

it("retains the last known maximize state when a native resize query fails", async () => {
  const { api, controller, failed, resize } = setup();
  await controller.connect();
  const initial = controller.getSnapshot(), failure = new Error("Window state unavailable");
  vi.mocked(api.isMaximized).mockRejectedValue(failure);
  resize(true);
  await vi.waitFor(() => expect(failed).toHaveBeenCalledWith(failure));
  expect(controller.getSnapshot()).toBe(initial);
  controller.dispose();
});

it("continues to query state after resize-listener registration fails", async () => {
  const { api, controller, failed } = setup();
  vi.mocked(api.onResized).mockRejectedValue(new Error("Resize listener unavailable"));
  vi.mocked(api.isMaximized).mockResolvedValue(true);
  await controller.connect();
  expect(failed).toHaveBeenCalledOnce(); expect(controller.getSnapshot().maximized).toBe(true);
  controller.dispose();
});
