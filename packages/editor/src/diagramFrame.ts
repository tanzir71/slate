import mermaid from "mermaid";
import type { RichRenderReply, RichRenderRequest } from "./richPreviewProtocol.js";

const token = location.hash.slice(1);
let sequence = 0;
async function diagram(request: RichRenderRequest): Promise<RichRenderReply> {
  const stage = document.body.appendChild(document.createElement("div"));
  try {
    if (request.kind !== "diagram" || request.body.length > 20_000) throw Error("Diagram is too large.");
    mermaid.initialize({ startOnLoad: false, securityLevel: "sandbox", suppressErrorRendering: true,
      htmlLabels: false, flowchart: { htmlLabels: false }, maxTextSize: 20_000, maxEdges: 100,
      theme: request.theme === "dark" ? "dark" : "default",
      secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "suppressErrorRendering", "theme", "themeCSS", "themeVariables", "htmlLabels", "flowchart"] });
    const result = await mermaid.render("slate-diagram-" + ++sequence, request.body, stage);
    const template = document.createElement("template"); template.innerHTML = result.svg;
    const frame = template.content.querySelector("iframe");
    const prefix = "data:text/html;charset=UTF-8;base64,";
    if (!frame?.src.startsWith(prefix)) throw Error("Expected sandboxed diagram output.");
    const bytes = Uint8Array.from(atob(frame.src.slice(prefix.length)), character => character.charCodeAt(0));
    template.innerHTML = new TextDecoder().decode(bytes);
    const svg = template.content.querySelector("svg"); if (!svg) throw Error("Diagram is empty.");
    const box = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    const width = box?.[2], height = box?.[3];
    if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) throw Error("Invalid diagram dimensions.");
    // The final frame has no script/origin/navigation capabilities; discard active/resource elements too.
    for (const element of svg.querySelectorAll("script,iframe,object,embed,image")) element.remove();
    for (const element of svg.querySelectorAll("a")) element.replaceWith(...element.childNodes);
    return { id: request.id, result: { html: svg.outerHTML, width, height } };
  } catch { return { id: request.id, error: "Diagram preview unavailable" }; }
  finally { stage.remove(); }
}
let port: MessagePort | undefined;
window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!token || event.source !== parent || !event.data || typeof event.data !== "object") return;
  const connection = event.data as { token?: unknown; connect?: unknown };
  if (port || connection.token !== token || connection.connect !== true || !event.ports[0]) return;
  const connected = port = event.ports[0];
  connected.onmessage = (event: MessageEvent<unknown>) => {
    if (!event.data || typeof event.data !== "object") return;
    const request = event.data as RichRenderRequest & { token?: unknown };
    if (request.token !== token || typeof request.id !== "number" || typeof request.body !== "string") return;
    void diagram(request).then(reply => {
      try { connected.postMessage({ ...reply, token }); } catch { /* The owning editor has closed. */ }
    });
  };
  connected.start();
});
window.addEventListener("pagehide", () => { if (port) { port.onmessage = null; port.close(); port = undefined; } });
if (token && parent !== window) parent.postMessage({ token, ready: true }, "*");
