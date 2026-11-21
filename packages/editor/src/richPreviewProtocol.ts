import type { RichPreviewRequest, RichPreviewResult } from "./richPreviewRenderer.js";

export interface RichRenderRequest extends RichPreviewRequest { id: number }
export type RichRenderReply = { id: number; result: RichPreviewResult } | { id: number; error: string };
export interface RichRenderTransport {
  postMessage(request: RichRenderRequest): void;
  onmessage: ((event: MessageEvent<RichRenderReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}
