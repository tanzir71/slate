import katex from "katex";
import type { RichRenderReply, RichRenderRequest } from "./richPreviewProtocol.js";

/** Executed only in the lazy math worker, with a fresh macro scope for each formula. */
export function renderMath(request: RichRenderRequest): RichRenderReply {
  try {
    if (request.kind !== "math" || request.body.length > 20_000) throw Error("Formula is too large.");
    const html = katex.renderToString(request.body, { output: "mathml", displayMode: request.display,
      trust: false, strict: "error", throwOnError: true, maxExpand: 1_000, maxSize: 10 });
    return { id: request.id, result: { html } };
  } catch { return { id: request.id, error: "Math preview unavailable" }; }
}
