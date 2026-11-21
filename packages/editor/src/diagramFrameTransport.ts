import type { RichRenderReply, RichRenderTransport } from "./richPreviewProtocol.js";

/** The trusted engine gets its own restrictive document before parsing any note. */
export function createDiagramFrameTransport(): RichRenderTransport {
  const frame = document.createElement("iframe"), token = crypto.randomUUID();
  frame.title = "Diagram renderer"; frame.tabIndex = -1; frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:600px;visibility:hidden;border:0;pointer-events:none";
  let ready = false, closed = false, pending: Parameters<RichRenderTransport["postMessage"]>[0] | undefined;
  let channel: MessageChannel | undefined;
  const fail = () => transport.onerror?.(new ErrorEvent("error", { message: "Diagram renderer unavailable", cancelable: true }));
  const timeout = setTimeout(fail, 10_000);
  const receiveReply = (event: MessageEvent<unknown>) => {
    if (closed || !event.data || typeof event.data !== "object") return;
    const reply = event.data as { token?: unknown; id?: unknown; result?: unknown; error?: unknown };
    if (reply.token === token && typeof reply.id === "number" && (typeof reply.error === "string" || reply.result && typeof reply.result === "object" && typeof Reflect.get(reply.result, "html") === "string"))
      transport.onmessage?.(new MessageEvent<RichRenderReply>("message", { data: reply as RichRenderReply }));
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (closed || event.source !== frame.contentWindow || !event.data || typeof event.data !== "object") return;
    const reply = event.data as { token?: unknown; ready?: unknown };
    if (reply.token !== token || reply.ready !== true || channel) return;
    try {
      channel = new MessageChannel(); channel.port1.onmessage = receiveReply; channel.port1.onmessageerror = fail; channel.port1.start();
      // Authenticate the window once, then keep renderer replies on its private capability.
      // WebKit can report a different incumbent window for a reply after nested-frame rendering.
      frame.contentWindow?.postMessage({ token, connect: true }, "*", [channel.port2]);
      ready = true; clearTimeout(timeout);
      if (pending) { const request = pending; pending = undefined; transport.postMessage(request); }
    } catch { fail(); }
  };
  const transport: RichRenderTransport = {
    onmessage: null, onerror: null,
    postMessage(request) {
      if (closed) throw Error("Diagram renderer closed.");
      if (!ready) { pending = request; return; }
      channel?.port1.postMessage({ ...request, token });
    },
    terminate() {
      if (closed) return; closed = true; pending = undefined; clearTimeout(timeout); window.removeEventListener("message", receive);
      if (channel) { channel.port1.onmessage = null; channel.port1.onmessageerror = null; channel.port1.close(); }
      frame.remove();
    },
  };
  window.addEventListener("message", receive); frame.addEventListener("error", fail);
  frame.src = new URL(`diagram-preview.html#${token}`, document.baseURI).href; document.body.append(frame);
  return transport;
}
