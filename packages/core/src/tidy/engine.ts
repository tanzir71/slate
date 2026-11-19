import { applyTextChanges, type TextChange } from "../textChanges.js";
import { blockRules } from "./blockRules.js";
import {
  readTidyConfiguration,
  type TidyConfiguration,
  type TidyRuleId,
} from "./configuration.js";
import { inlineRules } from "./inlineRules.js";
import { projectTidyDocument } from "./projection.js";
import { ruleContext } from "./ruleContext.js";
import { parseTidyDocument, type TidyDocument } from "./source.js";
import { tableYamlRules } from "./tableYamlRules.js";
import type { TidyIssue, TidyReport, TidyResult } from "./types.js";
import { uniqueChanges, whitespaceRules } from "./whitespaceRules.js";

const order: readonly TidyRuleId[] = [
  "yaml-style",
  "no-hard-tabs",
  "heading-start-left",
  "heading-space",
  "list-marker",
  "ol-prefix",
  "list-indent",
  "list-marker-space",
  "emphasis-style",
  "strong-style",
  "table-pipes",
  "table-align",
  "bare-urls",
  "blanks-around-headings",
  "blanks-around-lists",
  "blanks-around-fences",
  "trailing-space",
  "multiple-blanks",
  "final-newline",
];

function collect(
  document: TidyDocument,
  configuration: TidyConfiguration,
): TidyIssue[] {
  const context = ruleContext(document, configuration);
  blockRules(context);
  inlineRules(context);
  tableYamlRules(context);
  whitespaceRules(context);
  return context.issues.sort(
    (a, b) =>
      a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule),
  );
}
export function lint(
  source: string,
  configuration: TidyConfiguration = readTidyConfiguration(),
): TidyReport {
  return {
    source,
    configuration,
    issues: collect(parseTidyDocument(source), configuration),
  };
}
function overlaps(a: Readonly<TextChange>, b: Readonly<TextChange>): boolean {
  if (a.from === a.to) return b.from < a.from && a.from < b.to;
  if (b.from === b.to) return a.from < b.from && b.from < a.to;
  return a.from < b.to && b.from < a.to;
}
function remap(
  changes: readonly Readonly<TextChange>[],
  accepted: readonly Readonly<TextChange>[],
): TextChange[] | undefined {
  function position(offset: number, afterInsert: boolean): number {
    let mapped = offset;
    for (const change of accepted) {
      if (
        change.to < offset ||
        (change.to === offset && (change.from !== change.to || afterInsert))
      )
        mapped += change.text.length - (change.to - change.from);
    }
    return mapped;
  }
  const result: TextChange[] = [];
  for (const change of changes) {
    if (accepted.some((previous) => overlaps(change, previous))) return;
    result.push({
      from: position(change.from, true),
      to: position(change.to, change.from === change.to),
      text: change.text,
    });
  }
  return result;
}
function combinedChanges(issues: readonly TidyIssue[]): TextChange[] {
  const ranges = new Map<TidyRuleId, readonly Readonly<TextChange>[]>();
  for (const rule of [
    "trailing-space",
    "final-newline",
    "table-align",
  ] as const) {
    ranges.set(
      rule,
      issues
        .filter((issue) => issue.rule === rule)
        .flatMap((issue) => issue.changes)
        .sort((a, b) => a.from - b.from),
    );
  }
  function covered(rule: TidyRuleId, change: Readonly<TextChange>): boolean {
    const candidates = ranges.get(rule) ?? [];
    let low = 0,
      high = candidates.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (candidates[mid]!.from <= change.from) low = mid + 1;
      else high = mid;
    }
    return low > 0 && candidates[low - 1]!.to >= change.to;
  }
  return uniqueChanges(
    issues.flatMap((issue) =>
      issue.changes.filter((change) => {
        if (issue.rule === "no-hard-tabs" && covered("trailing-space", change))
          return false;
        if (
          issue.rule === "multiple-blanks" &&
          covered("final-newline", change)
        )
          return false;
        if (issue.rule === "table-pipes" && covered("table-align", change))
          return false;
        return true;
      }),
    ),
  );
}
function finalChange(source: string, output: string): TextChange[] {
  if (source === output) return [];
  let from = 0,
    to = source.length,
    end = output.length;
  while (from < to && from < end && source[from] === output[from]) from++;
  while (to > from && end > from && source[to - 1] === output[end - 1]) {
    to--;
    end--;
  }
  return [{ from, to, text: output.slice(from, end) }];
}

/** Generate proposals and prove every applied atomic group before returning one editor change. */
export function fix(
  source: string,
  configuration: TidyConfiguration = readTidyConfiguration(),
  issueIds?: readonly string[],
): TidyResult {
  let current = parseTidyDocument(source);
  const original = current,
    applied: TidyIssue[] = [],
    rejected: TidyResult["rejected"][number][] = [];
  let originalProjection: string | undefined;
  function attempt(
    changes: readonly TextChange[],
  ): "applied" | "unchanged" | "content-change" | "invalid-changes" {
    let candidate: string;
    try {
      candidate = applyTextChanges(current.source, changes);
    } catch {
      return "invalid-changes";
    }
    if (candidate === current.source) return "unchanged";
    const next = parseTidyDocument(candidate);
    originalProjection ??= projectTidyDocument(original);
    if (projectTidyDocument(next) !== originalProjection)
      return "content-change";
    current = next;
    return "applied";
  }
  function applyGroup(
    issues: readonly TidyIssue[],
    acceptedOriginal: TextChange[],
  ) {
    const originals = uniqueChanges(issues.flatMap((issue) => issue.changes)),
      mapped = remap(originals, acceptedOriginal);
    if (!originals.length) return;
    const result = mapped ? attempt(mapped) : "invalid-changes";
    if (result === "applied" || result === "unchanged") {
      applied.push(...issues);
      acceptedOriginal.push(...originals);
      return;
    }
    // A single unsafe proposal must not prevent independent safe repairs.
    for (const issue of issues) {
      const unique = uniqueChanges(issue.changes).filter(
        (change) =>
          !acceptedOriginal.some(
            (previous) =>
              previous.from === change.from &&
              previous.to === change.to &&
              previous.text === change.text,
          ),
      );
      if (!unique.length) continue;
      const changes = remap(unique, acceptedOriginal),
        single = changes ? attempt(changes) : "invalid-changes";
      if (single === "applied" || single === "unchanged") {
        applied.push(issue);
        acceptedOriginal.push(...unique);
      } else if (
        !rejected.some(
          (entry) => entry.issue.id === issue.id && entry.reason === single,
        )
      )
        rejected.push({ issue, reason: single });
    }
  }
  let pending = collect(current, configuration);
  if (issueIds) {
    const selected = new Set(issueIds),
      initial = pending.filter(
        (issue) => selected.has(issue.id) && issue.changes.length,
      ),
      accepted: TextChange[] = [];
    for (const rule of order)
      applyGroup(
        initial.filter((issue) => issue.rule === rule),
        accepted,
      );
    if (current.source !== source) pending = collect(current, configuration);
  } else {
    for (let pass = 0; pass < 8; pass++) {
      const before = current.source;
      const proposals = pending.filter((issue) => issue.changes.length);
      if (!proposals.length) break;
      // Apply-all is one atomic proposal. Prove disjoint repairs together before
      // falling back to per-rule/per-issue proofs for overlaps or unsafe edits.
      const combined = attempt(combinedChanges(proposals));
      if (combined === "applied" || combined === "unchanged") {
        applied.push(...proposals);
        pending = collect(current, configuration);
        if (combined === "unchanged") break;
        continue;
      }
      for (const rule of order) {
        const issues = pending.filter(
          (issue) => issue.rule === rule && issue.changes.length,
        );
        const beforeRule = current.source;
        applyGroup(issues, []);
        if (current.source !== beforeRule)
          pending = collect(current, configuration);
      }
      if (current.source === before) break;
    }
  }
  return {
    source,
    output: current.source,
    changes: finalChange(source, current.source),
    applied,
    rejected,
    issues: pending,
  };
}
