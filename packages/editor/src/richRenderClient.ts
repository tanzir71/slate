import type { RichPreviewRequest, RichPreviewResult } from "./richPreviewRenderer.js";
import type { RichRenderRequest, RichRenderTransport } from "./richPreviewProtocol.js";

interface Job {
  request: RichRenderRequest;
  signal: AbortSignal;
  resolve(result: RichPreviewResult): void;
  reject(error: Error | DOMException): void;
  abort(): void;
}
const aborted = () => new DOMException("Preview was closed.", "AbortError");

/** One in-flight render; cancelled queued work never reaches the engine. */
export function createRichRenderClient(transport: RichRenderTransport) {
  let sequence = 0, closed = false, active: Job | undefined;
  const queue: Job[] = [];
  const cleanup = (job: Job) => job.signal.removeEventListener("abort", job.abort);
  function close(error: Error | DOMException = aborted()) {
    if (closed) return;
    closed = true;
    for (const job of [...(active ? [active] : []), ...queue]) { cleanup(job); job.reject(error); }
    active = undefined; queue.length = 0;
    transport.onmessage = null; transport.onerror = null; transport.terminate();
  }
  function next() {
    if (closed || active || !queue.length) return;
    active = queue.shift()!;
    try { transport.postMessage(active.request); } catch { close(new Error("Preview could not start.")); }
  }
  transport.onmessage = ({ data }) => {
    if (closed || !active || data.id !== active.request.id) return;
    const job = active; active = undefined; cleanup(job);
    if (!job.signal.aborted) {
      if ("error" in data) job.reject(new Error(data.error)); else job.resolve(data.result);
    }
    next();
  };
  transport.onerror = event => { event.preventDefault(); close(new Error("Preview could not finish.")); };
  return {
    render(request: RichPreviewRequest, signal: AbortSignal): Promise<RichPreviewResult> {
      if (closed || signal.aborted) return Promise.reject(aborted());
      return new Promise((resolve, reject) => {
        const job: Job = { request: { ...request, id: ++sequence }, signal, resolve, reject, abort() {
          cleanup(job); const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1);
          reject(aborted());
        } };
        signal.addEventListener("abort", job.abort, { once: true }); queue.push(job); next();
      });
    },
    destroy: () => close(),
  };
}
