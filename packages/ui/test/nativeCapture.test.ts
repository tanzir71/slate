import { expect, it, vi } from "vitest";
import { createNativeCaptureActions } from "../src/native/nativeCapture";
import type { TauriInvoke } from "../src/tauriAutosave";

it("manual capture supplies only its admitted Space ID and exposes shortcut registration failures", async () => {
  const invoke = vi.fn(async () => ({ shortcutError: "Shortcut already reserved", lastError: null }));
  const actions = createNativeCaptureActions(invoke as TauriInvoke, "native-default");
  expect(await actions.activate()).toBe("Shortcut already reserved"); await actions.open();
  expect(invoke.mock.calls).toEqual([["set_capture_space", { spaceId: "native-default" }], ["open_native_capture", { spaceId: "native-default" }]]);
});

it("Space activations remain ordered across held native replies and a failed activation", async () => {
  let resolve!: (reply: unknown) => void;
  const held = new Promise<unknown>(yes => { resolve = yes; });
  const invoke = vi.fn().mockReturnValueOnce(held).mockRejectedValueOnce({ kind: "io", message: "Folder offline" }).mockResolvedValue({ shortcutError: null, lastError: null });
  const first = createNativeCaptureActions(invoke as TauriInvoke, "first").activate();
  const second = createNativeCaptureActions(invoke as TauriInvoke, "second").activate();
  await Promise.resolve(); expect(invoke).toHaveBeenCalledOnce();
  resolve({ shortcutError: null, lastError: null }); await first;
  await expect(second).rejects.toThrow("Folder offline");
  await createNativeCaptureActions(invoke as TauriInvoke, "third").activate();
  expect(invoke.mock.calls.map(call => call[1])).toEqual([{ spaceId: "first" }, { spaceId: "second" }, { spaceId: "third" }]);
});
