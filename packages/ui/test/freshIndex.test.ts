import { expect, it, vi } from "vitest";
import { createFreshIndex } from "../src/browser/freshIndex";

it("refuses stale cache results after a failed rebuild and permits the repaired cache", async () => {
  const cache = { rebuild: vi.fn(async () => undefined), search: vi.fn(async () => ["old.md"]), close: vi.fn() };
  const index = createFreshIndex(cache);
  await index.rebuild([]);
  expect(await index.search("words")).toEqual(["old.md"]);
  cache.rebuild.mockRejectedValueOnce(new Error("Permission denied"));
  await expect(index.rebuild([])).rejects.toThrow("Permission denied");
  await expect(index.search("new words")).rejects.toThrow("current files");
  expect(cache.search).toHaveBeenCalledOnce();
  await index.rebuild([]);
  cache.search.mockResolvedValueOnce(["new.md"]);
  expect(await index.search("new words")).toEqual(["new.md"]);
});

it("discards an in-flight query when a new file revision arrives", async () => {
  let finish: ((paths: string[]) => void) | undefined;
  const cache = { rebuild: vi.fn(async () => undefined), search: vi.fn(() => new Promise<string[]>((resolve) => { finish = resolve; })), close: vi.fn() };
  const index = createFreshIndex(cache);
  await index.rebuild([]);
  const old = index.search("old");
  index.invalidate();
  finish!(["old.md"]);
  await expect(old).rejects.toThrow("cache changed");
});

it("serializes rebuilds and cannot become ready from an older completion", async () => {
  let finish: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { finish = resolve; });
  const cache = { rebuild: vi.fn(async (_sheets: { path: string; content: string }[]): Promise<void> => undefined).mockImplementationOnce(() => held), search: vi.fn(async () => []), close: vi.fn() };
  const index = createFreshIndex(cache);
  const first = index.rebuild([{ path: "a.md", content: "first" }]);
  const second = index.rebuild([{ path: "b.md", content: "second" }]);
  await vi.waitFor(() => expect(cache.rebuild).toHaveBeenCalledTimes(1));
  await expect(index.search("words")).rejects.toThrow("current files");
  finish!();
  await Promise.all([first, second]);
  expect(cache.rebuild.mock.calls.map(([sheets]) => sheets)).toEqual([[{ path: "a.md", content: "first" }], [{ path: "b.md", content: "second" }]]);
  expect(await index.search("words")).toEqual([]);
});

it("closes once and prevents queued work or a late response from answering", async () => {
  let finish: ((paths: string[]) => void) | undefined;
  const cache = { rebuild: vi.fn(async () => undefined), search: vi.fn(() => new Promise<string[]>((resolve) => { finish = resolve; })), close: vi.fn() };
  const index = createFreshIndex(cache);
  await index.rebuild([]);
  const query = index.search("words");
  index.close(); index.close();
  finish!(["old.md"]);
  await expect(query).rejects.toThrow("cache changed");
  await expect(index.rebuild([])).rejects.toThrow("Space closed");
  expect(cache.close).toHaveBeenCalledOnce();
  expect(cache.rebuild).toHaveBeenCalledOnce();
});
