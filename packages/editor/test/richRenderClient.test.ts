import { expect, it, vi } from "vitest";
import { createRichRenderClient } from "../src/richRenderClient";
import type { RichRenderReply, RichRenderRequest, RichRenderTransport } from "../src/richPreviewProtocol";

function setup() {
  const sent: RichRenderRequest[] = [], terminate = vi.fn();
  const transport: RichRenderTransport = { onmessage: null, onerror: null, terminate, postMessage: request => sent.push(request) };
  return { client: createRichRenderClient(transport), sent, terminate, transport,
    reply: (data: RichRenderReply) => transport.onmessage?.(new MessageEvent("message", { data })) };
}
const request = { kind: "math", body: "x", display: false, theme: "light" } as const;

it("serializes renders and ignores a reply belonging to a different request", async () => {
  const { client, sent, reply } = setup(), signal = new AbortController().signal;
  const first = client.render(request, signal), second = client.render({ ...request, body: "y" }, signal);
  expect(sent).toHaveLength(1); reply({ id: 999, result: { html: "wrong" } }); expect(sent).toHaveLength(1);
  reply({ id: sent[0]!.id, result: { html: "first" } }); await expect(first).resolves.toEqual({ html: "first" });
  expect(sent).toHaveLength(2); expect(sent[1]!.body).toBe("y");
  reply({ id: sent[1]!.id, result: { html: "second" } }); await expect(second).resolves.toEqual({ html: "second" }); client.destroy();
});

it("drops cancelled queued work and rejects an active render without accepting its late output", async () => {
  const { client, sent, reply } = setup(), active = new AbortController(), queued = new AbortController();
  const first = client.render(request, active.signal), second = client.render({ ...request, body: "cancelled" }, queued.signal);
  const firstRejected = expect(first).rejects.toMatchObject({ name: "AbortError" }), secondRejected = expect(second).rejects.toMatchObject({ name: "AbortError" });
  active.abort(); queued.abort(); await Promise.all([firstRejected, secondRejected]);
  const third = client.render({ ...request, body: "current" }, new AbortController().signal);
  expect(sent).toHaveLength(1); reply({ id: sent[0]!.id, result: { html: "stale" } }); expect(sent).toHaveLength(2);
  expect(sent[1]!.body).toBe("current"); reply({ id: sent[1]!.id, result: { html: "current" } });
  await expect(third).resolves.toEqual({ html: "current" }); client.destroy();
});

it("reports a parse error without discarding the following valid formula", async () => {
  const { client, sent, reply } = setup(), signal = new AbortController().signal;
  const bad = client.render(request, signal), rejected = expect(bad).rejects.toThrow("invalid TeX");
  const good = client.render(request, signal); reply({ id: sent[0]!.id, error: "invalid TeX" }); await rejected;
  reply({ id: sent[1]!.id, result: { html: "valid" } }); await expect(good).resolves.toEqual({ html: "valid" }); client.destroy();
});

it("terminates once, removes handlers and rejects every pending or future request on disposal", async () => {
  const { client, transport, terminate } = setup(), signal = new AbortController().signal;
  const promises = [client.render(request, signal), client.render(request, signal)].map(value => expect(value).rejects.toMatchObject({ name: "AbortError" }));
  client.destroy(); client.destroy(); await Promise.all(promises);
  expect(terminate).toHaveBeenCalledTimes(1); expect(transport.onmessage).toBeNull(); expect(transport.onerror).toBeNull();
  await expect(client.render(request, signal)).rejects.toMatchObject({ name: "AbortError" });
});

it("turns transport crashes into a bounded failure and releases the engine", async () => {
  const { client, transport, terminate } = setup(), signal = new AbortController().signal;
  const failed = expect(client.render(request, signal)).rejects.toThrow("could not finish");
  transport.onerror!(new ErrorEvent("error", { cancelable: true })); await failed; expect(terminate).toHaveBeenCalledTimes(1);
});
