import { expect, it, vi } from "vitest";
import { createTauriWorkspaceIndex } from "../src/tauriWorkspaceIndex";
import type { TauriInvoke } from "../src/tauriFileSource";

it("rebuilds from current files through a single transactional native request and searches the cache", async () => {
  const close = vi.fn(async () => undefined);
  const execute = vi.fn(async () => ({}));
  const select = vi.fn(async () => [{ id: "id", path: "real.md", title: "Real", body: "Words", tags_json: "[]", links_json: "[]", words: 1, updated_at: null, content_hash: "hash" }]);
  const loadDatabase = vi.fn(async () => ({ close, execute,
    // The SQL driver returns caller-selected row types; this fixture serves one known row shape.
    select: async <Row>() => await select() as unknown as Row[],
  }));
  const invoke = vi.fn(async () => undefined);
  const index = createTauriWorkspaceIndex({ loadDatabase }, invoke as TauriInvoke);
  await index.rebuild([{ path: "real.md", content: "# Real\n\nWords" }, { path: "bad.md", content: "", unsupportedEncoding: true }]);
  expect(loadDatabase).toHaveBeenCalledWith("sqlite:slate-index.sqlite");
  expect(execute).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("replace_workspace_index", { rows: [expect.objectContaining({ entry: expect.objectContaining({ path: "real.md", title: "Real" }), body: expect.stringContaining("Words") })] });
  expect(await index.search("Words")).toEqual(["real.md"]);
  index.close();
  await expect(index.search("Words")).rejects.toThrow("Space closed");
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
});

it("serializes replacements and recovers after a failed replacement without writing source files", async () => {
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const execute = vi.fn(async () => ({})), select = vi.fn(async () => []);
  const invoke = vi.fn(async (): Promise<void> => undefined).mockImplementationOnce(async () => held);
  const index = createTauriWorkspaceIndex({ loadDatabase: async () => ({ execute, select }) }, invoke as TauriInvoke);
  const first = index.rebuild([{ path: "a.md", content: "first" }]);
  const second = index.rebuild([{ path: "b.md", content: "second" }]);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  release!();
  await Promise.all([first, second]);
  expect(invoke).toHaveBeenCalledTimes(2);
  invoke.mockRejectedValueOnce(new Error("Cache unavailable"));
  await expect(index.rebuild([])).rejects.toThrow("Cache unavailable");
  await expect(index.rebuild([])).resolves.toBeUndefined();
  expect(execute.mock.calls.length).toBe(2);
  index.close();
});
