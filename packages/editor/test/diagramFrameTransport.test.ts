import { afterEach, expect, it, vi } from "vitest";
import { createDiagramFrameTransport } from "../src/diagramFrameTransport";
import type { RichRenderTransport } from "../src/richPreviewProtocol";

const transports: RichRenderTransport[] = [];
class Port {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn(); close = vi.fn(); start = vi.fn();
  receive(data: unknown) { this.onmessage?.(new MessageEvent("message", { data })); }
}
const channels: Channel[] = [];
class Channel { port1 = new Port(); port2 = new Port(); constructor() { channels.push(this); } }
afterEach(() => { for (const transport of transports.splice(0)) transport.terminate(); channels.length = 0; vi.useRealTimers(); vi.unstubAllGlobals(); });
const request = { id: 1, kind: "diagram", body: "flowchart LR\n A-->B", display: true, theme: "dark" } as const;
function setup() {
  vi.stubGlobal("MessageChannel", Channel);
  const transport = createDiagramFrameTransport(); transports.push(transport);
  const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Diagram renderer"]')!;
  const token = new URL(frame.src).hash.slice(1), post = vi.spyOn(frame.contentWindow!, "postMessage");
  const receive = (data: unknown, source: MessageEventSource | null = frame.contentWindow) => window.dispatchEvent(new MessageEvent("message", { source, data }));
  return { transport, frame, token, post, receive };
}

it("waits for the exact engine window and session token before sending any note", () => {
  const { transport, frame, token, post, receive } = setup(); transport.postMessage(request);
  expect(frame.src).not.toContain("flowchart"); expect(post).not.toHaveBeenCalled();
  receive({ token, ready: true }, window); receive({ token: "wrong", ready: true }); expect(post).not.toHaveBeenCalled();
  receive({ token, ready: true });
  expect(channels).toHaveLength(1);
  expect(post).toHaveBeenCalledExactlyOnceWith({ token, connect: true }, "*", [channels[0]!.port2]);
  expect(channels[0]!.port1.postMessage).toHaveBeenCalledExactlyOnceWith({ ...request, token });
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin"); expect(frame.getAttribute("aria-hidden")).toBe("true");
});

it("rejects forged engine results and removes its window on disposal", () => {
  const { transport, frame, token, receive } = setup(), message = vi.fn(); transport.onmessage = message;
  receive({ token: "wrong", id: 1, result: { html: "forged" } }); receive({ token, id: 1, result: { html: "forged" } }, window); expect(message).not.toHaveBeenCalled();
  receive({ token, ready: true }); const port = channels[0]!.port1;
  receive({ token, id: 1, result: { html: "window message" } }); expect(message).not.toHaveBeenCalled();
  port.receive({ token: "wrong", id: 1, result: { html: "forged" } }); expect(message).not.toHaveBeenCalled();
  port.receive({ token, id: 1, result: { html: "<svg></svg>" } }); expect(message).toHaveBeenCalledTimes(1);
  transport.terminate(); expect(frame.isConnected).toBe(false); expect(port.close).toHaveBeenCalledTimes(1);
  expect(port.onmessage).toBeNull(); port.receive({ token, id: 1, result: { html: "late" } }); expect(message).toHaveBeenCalledTimes(1);
});

it("reports a missing engine rather than leaving a preview loading forever", () => {
  vi.useFakeTimers(); const { transport } = setup(), error = vi.fn(); transport.onerror = error;
  vi.advanceTimersByTime(10_000); expect(error).toHaveBeenCalledTimes(1); transport.terminate();
  vi.advanceTimersByTime(10_000); expect(error).toHaveBeenCalledTimes(1);
});
