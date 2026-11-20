import type { MarkdownMentionPlan, WikiCompletionTarget } from "@slate/core";

export interface MentionInput { readonly path: string; readonly content: string; readonly unsupportedEncoding?: boolean }
export interface MentionTarget extends WikiCompletionTarget { readonly source: string }
export interface MentionRow { readonly path: string; readonly plan: MarkdownMentionPlan }
export interface MentionRead { readonly sheets: readonly MentionInput[]; readonly target: MentionTarget | undefined }
export interface MentionRequest {
  readonly id: number;
  readonly target: MentionTarget | undefined;
  readonly changed: readonly MentionInput[];
  readonly removed: readonly string[];
}
export interface MentionReply {
  readonly id: number;
  readonly reset: boolean;
  readonly changed: readonly MentionRow[];
  readonly removed: readonly string[];
  readonly error?: string;
}
export type MentionSnapshot =
  | { readonly status: "pending" | "unavailable"; readonly error?: string }
  | { readonly status: "ready"; readonly review: MentionRead; readonly rows: readonly MentionRow[] };
