import { applyTextChanges } from "@slate/core";
import type { TidyIssue, TidyReport } from "@slate/core/tidy";

export interface TidyPreview {
  readonly issue: TidyIssue;
  readonly before: string;
  readonly after?: string;
}
/** Build bounded excerpts in one source pass; large documents never become one preview per full file. */
export function tidyPreviews(report: TidyReport, limit: number): TidyPreview[] {
  const lines: { from: number; to: number }[] = [];
  let from = 0;
  for (const match of report.source.matchAll(/\r\n|\n|\r/g)) {
    lines.push({ from, to: match.index });
    from = match.index + match[0].length;
  }
  lines.push({ from, to: report.source.length });
  return report.issues.slice(0, limit).map((issue) => {
    const line = lines[issue.line - 1] ?? { from: 0, to: 0 };
    const focus = Math.max(
      line.from,
      Math.min(line.to, issue.changes[0]?.from ?? line.from + issue.column - 1),
    );
    const start = Math.max(line.from, focus - 50),
      end = Math.min(line.to, start + 180);
    const original = report.source.slice(start, end);
    const display = (text: string) =>
      `${start > line.from ? "…" : ""}${text.replace(/\r\n|\n|\r/g, "↵")}${end < line.to ? "…" : ""}`;
    const before = display(original);
    if (
      !issue.changes.length ||
      issue.changes.some((change) => change.from < start || change.to > end)
    )
      return { issue, before };
    try {
      return {
        issue,
        before,
        after: display(
          applyTextChanges(
            original,
            issue.changes.map((change) => ({
              ...change,
              from: change.from - start,
              to: change.to - start,
            })),
          ),
        ),
      };
    } catch {
      return { issue, before };
    }
  });
}
