import type { TextChange } from "../textChanges.js";
import type { TidyConfiguration, TidyRuleId } from "./configuration.js";

export interface TidyIssue {
  readonly id: string;
  readonly rule: TidyRuleId;
  readonly message: string;
  readonly line: number;
  readonly column: number;
  readonly changes: readonly Readonly<TextChange>[];
}
export interface TidyReport {
  readonly source: string;
  readonly configuration: TidyConfiguration;
  readonly issues: readonly TidyIssue[];
}
export interface TidyResult {
  readonly source: string;
  readonly output: string;
  readonly changes: readonly Readonly<TextChange>[];
  readonly applied: readonly TidyIssue[];
  readonly rejected: readonly {
    readonly issue: TidyIssue;
    readonly reason: "content-change" | "invalid-changes";
  }[];
  readonly issues: readonly TidyIssue[];
}
