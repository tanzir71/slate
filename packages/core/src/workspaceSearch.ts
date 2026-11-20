import { applyTextChanges, type TextChange } from "./textChanges.js";

export interface LiteralSearchOptions { readonly matchCase?: boolean }
export interface SourceMatch {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly line: number;
  readonly column: number;
}
export interface LiteralReplacementPlan {
  readonly source: string;
  readonly output: string;
  readonly changes: readonly TextChange[];
  readonly matches: number;
}

/** Literal, non-overlapping matches with offsets into the unchanged physical source. */
export function* findLiteralMatches(source: string, query: string, options: LiteralSearchOptions = {}): Generator<SourceMatch> {
  if (!query) return;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, options.matchCase ? "gu" : "giu");
  let scanned = 0, line = 1, lineFrom = 0;
  for (const match of source.matchAll(pattern)) {
    const from = match.index, text = match[0];
    while (scanned < from) {
      const code = source.charCodeAt(scanned);
      const width = code === 13 ? source.charCodeAt(scanned + 1) === 10 ? 2 : 1 : code === 10 ? 1 : 0;
      // The LF half of CRLF still belongs to the preceding physical line.
      if (width && scanned + width > from) break;
      scanned += width || 1;
      if (width) { line++; lineFrom = scanned; }
    }
    yield { from, to: from + text.length, text, line, column: from - lineFrom + 1 };
  }
}

/** Replacement text is literal: dollar signs, backslashes and line endings keep their meaning. */
export function planLiteralReplacement(source: string, query: string, replacement: string, options: LiteralSearchOptions = {}): LiteralReplacementPlan {
  const changes: TextChange[] = [];
  let matches = 0;
  for (const match of findLiteralMatches(source, query, options)) {
    matches++;
    if (match.text !== replacement) changes.push({ from: match.from, to: match.to, text: replacement });
  }
  return { source, output: applyTextChanges(source, changes), changes, matches };
}
