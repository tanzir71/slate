import { expect, it, vi } from "vitest";
import { planMarkdownMentionLinks, scanMarkdownMentionText } from "@slate/core";
import { createInspectorMentionClient, type MentionWorker } from "../src/browser/inspectorMentionClient";
import type { MentionReply, MentionSnapshot } from "../src/browser/inspectorMentionProtocol";

const target = { id: "target", path: "target.md", title: "Launch plan", source: "# Launch plan" };
function worker(): MentionWorker { return { onmessage: null, onerror: null, postMessage: vi.fn(), terminate: vi.fn() }; }
function reply(worker: MentionWorker, data: MentionReply) { worker.onmessage?.(new MessageEvent("message", { data })); }
const row = (path: string, source = "Launch plan") => ({ path, plan: planMarkdownMentionLinks(scanMarkdownMentionText(source), target)! });

it("coalesces reads behind one in-flight request, sends only source deltas and retains unpublished earlier results", () => {
  const background = worker(), changed = vi.fn<(snapshot: MentionSnapshot) => void>(), client = createInspectorMentionClient(background, changed);
  client.read({ target, sheets: [{ path: "a.md", content: "Launch plan" }] });
  client.read({ target, sheets: [{ path: "a.md", content: "Launch plan" }, { path: "old.md", content: "Old" }] });
  const latest = { target, sheets: [{ path: "a.md", content: "Launch plan" }, { path: "b.md", content: "Launch plan again" }] };
  client.read(latest); expect(background.postMessage).toHaveBeenCalledTimes(1);
  reply(background, { id: 1, reset: true, changed: [row("a.md")], removed: [] });
  expect(changed.mock.calls.some(([value]) => value.status === "ready")).toBe(false);
  expect(background.postMessage).toHaveBeenLastCalledWith({ id: 3, target, changed: [{ path: "b.md", content: "Launch plan again" }], removed: [] });
  reply(background, { id: 3, reset: false, changed: [row("b.md", "Launch plan again")], removed: [] });
  const snapshot = changed.mock.lastCall?.[0]; expect(snapshot?.status).toBe("ready");
  if (snapshot?.status !== "ready") throw Error("No ready snapshot");
  expect(snapshot.rows.map(row => row.path)).toEqual(["a.md", "b.md"]); expect(snapshot.review).toEqual(latest);
  client.read({ target, sheets: latest.sheets.slice(1) });
  expect(background.postMessage).toHaveBeenLastCalledWith({ id: 4, target, changed: [], removed: ["a.md"] });
  reply(background, { id: 4, reset: false, changed: [], removed: ["a.md"] });
  const final = changed.mock.lastCall?.[0]; expect(final?.status === "ready" && final.rows.map(row => row.path)).toEqual(["b.md"]);
});

it("discards unexpected replies and stops all work/callbacks after close or worker failure", () => {
  const background = worker(), changed = vi.fn(), client = createInspectorMentionClient(background, changed);
  client.read({ target, sheets: [] }); const calls = changed.mock.calls.length;
  reply(background, { id: 99, reset: true, changed: [], removed: [] }); expect(changed).toHaveBeenCalledTimes(calls);
  const old = background.onmessage; client.close(); client.close(); client.read({ target, sheets: [] });
  old?.(new MessageEvent("message", { data: { id: 1, reset: true, changed: [], removed: [] } }));
  expect(changed).toHaveBeenCalledTimes(calls); expect(background.terminate).toHaveBeenCalledTimes(1);
  const failed = worker(), updates = vi.fn(), other = createInspectorMentionClient(failed, updates);
  other.read({ target, sheets: [] }); failed.onerror?.(new ErrorEvent("error", { cancelable: true }));
  expect(updates.mock.lastCall?.[0].status).toBe("unavailable"); expect(failed.terminate).toHaveBeenCalledTimes(1);
});

it("reports unavailable workers without running semantic parsing on the UI thread", () => {
  const changed = vi.fn(), client = createInspectorMentionClient(undefined, changed);
  client.read({ target, sheets: [{ path: "huge.md", content: "Launch plan ".repeat(50_000) }] });
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ status: "unavailable" })); client.close();
});
