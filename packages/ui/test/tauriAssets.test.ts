import { expect, it, vi } from "vitest";
import { createTauriAssetWriter } from "../src/tauriAssets";
import type { TauriInvoke } from "../src/tauriAutosave";

it("sends binary bytes through native IPC and returns only the matching numbered PNG path", async () => {
  const invoke = vi.fn(async () => "Drafts/assets/image-2.png") as TauriInvoke;
  const writer = createTauriAssetWriter({ invoke });
  await expect(
    writer.importNumberedFile(
      "Drafts/assets/image.png",
      new Uint8Array([0, 255, 8]),
    ),
  ).resolves.toBe("Drafts/assets/image-2.png");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("write_numbered_asset", {
    path: "Drafts/assets/image.png",
    bytes: [0, 255, 8],
  });
});
it.each([
  null,
  {},
  "../image-1.png",
  "Other/assets/image-1.png",
  "Drafts/assets/image.png",
  "Drafts/assets/image-0.png",
  "Drafts/assets/image-1.jpg",
])("rejects a malformed or unrelated native path: %j", async (response) => {
  const invoke: TauriInvoke = async () => response as never;
  await expect(
    createTauriAssetWriter({ invoke }).importNumberedFile(
      "Drafts/assets/image.png",
      new Uint8Array([1]),
    ),
  ).rejects.toThrow("Invalid native asset response");
});
