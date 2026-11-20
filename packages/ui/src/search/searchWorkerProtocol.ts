import type { LiteralSearchOptions } from "@slate/core";
import type { SearchSheet, WorkspaceSearchResult } from "./searchResults";

export interface SearchWorkerRequest {
  readonly id: number;
  readonly version: number;
  readonly query: string;
  readonly options: LiteralSearchOptions;
  readonly sheets?: readonly SearchSheet[];
}
export type SearchWorkerReply = { readonly id: number; readonly version: number } & (
  { readonly kind: "result"; readonly result: WorkspaceSearchResult } |
  { readonly kind: "error"; readonly message: string }
);
