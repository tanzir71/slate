import {
  fix,
  lint,
  type TidyConfiguration,
  type TidyReport,
  type TidyResult,
} from "@slate/core/tidy";

export interface TidyWorkerRequest {
  readonly id: number;
  readonly kind: "lint" | "fix";
  readonly source: string;
  readonly configuration: TidyConfiguration;
  readonly issueIds?: readonly string[];
}
export type TidyWorkerReply =
  | {
      readonly id: number;
      readonly kind: "lint";
      readonly report: TidyReport;
      readonly elapsedMs: number;
    }
  | {
      readonly id: number;
      readonly kind: "fix";
      readonly result: TidyResult;
      readonly elapsedMs: number;
    }
  | { readonly id: number; readonly kind: "error"; readonly message: string };

/** No file or editor access crosses into the worker; it can only return proposals. */
export function runTidyRequest(
  request: TidyWorkerRequest,
  now: () => number = () => performance.now(),
): TidyWorkerReply {
  const started = now();
  try {
    if (request.kind === "lint") {
      const report = lint(request.source, request.configuration);
      return {
        id: request.id,
        kind: "lint",
        report,
        elapsedMs: now() - started,
      };
    }
    const result = fix(request.source, request.configuration, request.issueIds);
    return { id: request.id, kind: "fix", result, elapsedMs: now() - started };
  } catch (cause) {
    return {
      id: request.id,
      kind: "error",
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
