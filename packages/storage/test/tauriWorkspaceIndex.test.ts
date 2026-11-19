import { expect, it, vi } from "vitest";
import { createTauriWorkspaceIndex } from "../src/tauriWorkspaceIndex";
import type { TauriInvoke } from "../src/tauriFileSource";

it("uses fixed cache commands without exposing a database path or raw SQL", async () => {
  const invoke = vi.fn(async (command: string): Promise<unknown> => command === "search_workspace_index" ? ["real.md"] : null);
  const index = createTauriWorkspaceIndex({ invoke: invoke as TauriInvoke });
  await index.rebuild([{ path: "real.md", content: "# Real\n\nWords" }, { path: "bad.md", content: "Undecodable content must not be indexed", unsupportedEncoding: true }]);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("replace_workspace_index", { rows: [expect.objectContaining({ entry: expect.objectContaining({ path: "real.md", title: "Real" }), body: expect.stringContaining("Words") }), expect.objectContaining({ entry: expect.objectContaining({ path: "bad.md", title: "bad", words: 0 }), body: "" })] });
  expect(await index.search("Words")).toEqual(["real.md"]);
  expect(invoke).toHaveBeenLastCalledWith("search_workspace_index", { query: "Words" });
  index.close();
  await expect(index.search("Words")).rejects.toThrow("Space closed");
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("serializes replacements and recovers after a failed cache operation", async () => {
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const invoke = vi.fn(async (): Promise<unknown> => null).mockImplementationOnce(async () => held);
  const index = createTauriWorkspaceIndex({ invoke: invoke as TauriInvoke });
  const first = index.rebuild([{ path: "a.md", content: "first" }]);
  const second = index.rebuild([{ path: "b.md", content: "second" }]);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  release!();
  await Promise.all([first, second]);
  expect(invoke).toHaveBeenCalledTimes(2);
  invoke.mockRejectedValueOnce({ kind: "io", message: "Cache unavailable" });
  await expect(index.rebuild([])).rejects.toThrow("Cache unavailable");
  await index.rebuild([]);
  index.close();
});

it.each([null, ["../outside.md"], ["C:/outside.md"], [12], { paths: [] }])("rejects an invalid cache search response: %j", async (reply) => {
  const index = createTauriWorkspaceIndex({ invoke: vi.fn(async () => reply) as TauriInvoke });
  await expect(index.search("words")).rejects.toThrow("Invalid native search response");
  index.close();
});
