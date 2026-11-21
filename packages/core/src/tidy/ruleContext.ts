import type { TextChange } from "../textChanges.js";
import {
  enabledTidyRules,
  type TidyConfiguration,
  type TidyRuleId,
} from "./configuration.js";
import {
  lineAt,
  type TidyDocument,
  type TidyLine,
  type TidyNode,
  nodeRange,
} from "./source.js";
import type { TidyIssue } from "./types.js";

export interface RuleContext {
  readonly document: TidyDocument;
  readonly configuration: TidyConfiguration;
  readonly enabled: ReadonlySet<TidyRuleId>;
  readonly issues: TidyIssue[];
  add(
    rule: TidyRuleId,
    offset: number,
    message: string,
    changes?: readonly TextChange[],
  ): void;
}
export function ruleContext(
  document: TidyDocument,
  configuration: TidyConfiguration,
): RuleContext {
  const enabled = enabledTidyRules(configuration),
    issues: TidyIssue[] = [],
    seen = new Set<string>();
  return {
    document,
    configuration,
    enabled,
    issues,
    add(rule, offset, message, changes = []) {
      if (!enabled.has(rule)) return;
      if (document.mathRanges.length && changes.some(change => document.mathRanges.some(range =>
        change.from === change.to ? range.from < change.from && change.to < range.to
          : range.from <= change.from && change.to <= range.to))) return;
      const line = lineAt(document, offset);
      const id = `${rule}:${offset}:${changes.map(({ from, to }) => `${from}-${to}`).join(",")}`;
      if (seen.has(id)) return;
      seen.add(id);
      issues.push({
        id,
        rule,
        message,
        line: line.index + 1,
        column: offset - line.from + 1,
        changes: changes.map((change) => ({ ...change })),
      });
    },
  };
}
export function nodeLines(
  document: TidyDocument,
  node: TidyNode,
): readonly TidyLine[] {
  const range = nodeRange(document, node);
  if (!range) return [];
  const first = lineAt(document, range.from).index,
    last = lineAt(document, Math.max(range.from, range.to - 1)).index;
  return document.lines.slice(first, last + 1);
}
export function replaceIfDifferent(
  context: RuleContext,
  rule: TidyRuleId,
  from: number,
  to: number,
  text: string,
  message: string,
) {
  if (context.document.source.slice(from, to) !== text)
    context.add(rule, from, message, [{ from, to, text }]);
}
export function blankLine(line: TidyLine): boolean {
  return /^[ \t]*(?:>[ \t]*)*$/.test(line.text);
}
export function quotePrefix(text: string): string {
  return /^(?: {0,3}>[ \t]?)+/.exec(text)?.[0] ?? "";
}
