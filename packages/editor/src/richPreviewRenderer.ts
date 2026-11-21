import { createRichRenderClient } from "./richRenderClient.js";
import { createDiagramFrameTransport } from "./diagramFrameTransport.js";

export interface RichPreviewRequest {
  kind: "math" | "diagram";
  body: string;
  display: boolean;
  theme: "light" | "dark";
}
export interface RichPreviewResult { html: string; width?: number; height?: number }
export interface RichPreviewRenderer {
  render(request: RichPreviewRequest, signal: AbortSignal): Promise<RichPreviewResult>;
  destroy(): void;
}
export type RichPreviewRendererFactory = () => RichPreviewRenderer;

export function createDefaultRichPreviewRenderer(): RichPreviewRenderer {
  let math: ReturnType<typeof createRichRenderClient> | undefined, diagram: ReturnType<typeof createRichRenderClient> | undefined;
  let closed = false;
  return {
    render(request, signal) {
      if (closed || signal.aborted) return Promise.reject(new DOMException("Preview closed.", "AbortError"));
      if (request.body.length > 20_000) return Promise.reject(new Error("Preview is too large."));
      try {
        if (request.kind === "math") {
          math ??= createRichRenderClient(new Worker(new URL("./math.worker.ts", import.meta.url), { type: "module" }));
          return math.render(request, signal);
        }
        diagram ??= createRichRenderClient(createDiagramFrameTransport()); return diagram.render(request, signal);
      } catch { return Promise.reject(new Error("Preview is unavailable.")); }
    },
    destroy() { if (closed) return; closed = true; math?.destroy(); diagram?.destroy(); },
  };
}
