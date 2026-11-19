import type {
  TidyConfiguration,
  TidyReport,
  TidyResult,
} from "@slate/core/tidy";
import type { TidyWorkerReply, TidyWorkerRequest } from "./tidyWorkerProtocol";

export interface TidyWorker {
  postMessage(request: TidyWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<TidyWorkerReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
interface Pending {
  readonly request: TidyWorkerRequest;
  readonly resolve: (reply: TidyWorkerReply) => void;
  readonly reject: (error: Error | DOMException) => void;
}
const superseded = () =>
  new DOMException("A newer Tidy request replaced this one.", "AbortError");

/** Bound work to one active request and one latest snapshot, even during continuous typing. */
export function createTidyWorkerClient(worker: TidyWorker | undefined) {
  let id = 0;
  let closed = false;
  let inFlight: number | undefined;
  let active: Pending | undefined;
  let pending: Pending | undefined;
  function cancel() {
    active?.reject(superseded());
    pending?.reject(superseded());
    active = undefined;
    pending = undefined;
  }
  function close(
    error: Error | DOMException = new DOMException(
      "Tidy was closed.",
      "AbortError",
    ),
  ) {
    if (closed) return;
    closed = true;
    active?.reject(error);
    pending?.reject(error);
    active = undefined;
    pending = undefined;
    inFlight = undefined;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
  }
  function post() {
    if (closed || !worker || inFlight !== undefined || !pending) return;
    active = pending;
    pending = undefined;
    inFlight = active.request.id;
    try {
      worker.postMessage(active.request);
    } catch {
      close(new Error("Tidy could not start. Try again."));
    }
  }
  if (worker) {
    worker.onmessage = ({ data }) => {
      if (closed || data.id !== inFlight) return;
      inFlight = undefined;
      const current = active;
      active = undefined;
      if (current) {
        if (data.kind === "error") current.reject(new Error(data.message));
        else if (
          data.kind !== current.request.kind ||
          (data.kind === "lint" ? data.report.source : data.result.source) !==
            current.request.source
        ) {
          current.reject(
            new Error(
              "This Tidy result belongs to a different sheet snapshot.",
            ),
          );
        } else current.resolve(data);
      }
      post();
    };
    worker.onerror = (event) => {
      event.preventDefault();
      close(new Error("Tidy could not finish. Try again."));
    };
  }
  function request(
    kind: TidyWorkerRequest["kind"],
    source: string,
    configuration: TidyConfiguration,
    issueIds?: readonly string[],
  ): Promise<TidyWorkerReply> {
    if (closed || !worker)
      return Promise.reject(new Error("Tidy is unavailable. Try again."));
    cancel();
    return new Promise((resolve, reject) => {
      pending = {
        request: {
          id: ++id,
          kind,
          source,
          configuration,
          ...(issueIds === undefined ? {} : { issueIds }),
        },
        resolve,
        reject,
      };
      post();
    });
  }
  return {
    async lint(
      source: string,
      configuration: TidyConfiguration,
    ): Promise<TidyReport> {
      const reply = await request("lint", source, configuration);
      if (reply.kind !== "lint")
        throw new Error("Tidy returned an unexpected result.");
      return reply.report;
    },
    async fix(
      source: string,
      configuration: TidyConfiguration,
      issueIds?: readonly string[],
    ): Promise<TidyResult> {
      const reply = await request("fix", source, configuration, issueIds);
      if (reply.kind !== "fix")
        throw new Error("Tidy returned an unexpected result.");
      return reply.result;
    },
    cancel,
    close: () => close(),
  };
}
