import { findLiteralMatches, type LiteralSearchOptions, type SourceMatch } from "@slate/core";

export interface SearchSheet { readonly path: string; readonly content: string; readonly unsupportedEncoding?: boolean }
export interface SearchExcerpt extends SourceMatch {
  readonly before: string; readonly after: string; readonly clippedBefore: boolean; readonly clippedAfter: boolean;
}
export interface SearchFileResult {
  readonly path: string; readonly matches: number; readonly pathMatch: boolean; readonly unsupported: boolean;
  readonly excerpts: readonly SearchExcerpt[];
}
export interface WorkspaceSearchResult {
  readonly files: readonly SearchFileResult[];
  readonly totalFiles: number; readonly totalMatches: number; readonly unsupportedFiles: number;
}
const high = (code: number) => code >= 0xd800 && code <= 0xdbff;
const low = (code: number) => code >= 0xdc00 && code <= 0xdfff;
function excerpt(source: string, match: SourceMatch): SearchExcerpt {
  let from = Math.max(0, match.from - 60), to = Math.min(source.length, match.to + 60);
  if (from > 0 && low(source.charCodeAt(from)) && high(source.charCodeAt(from - 1))) from--;
  if (to < source.length && low(source.charCodeAt(to)) && high(source.charCodeAt(to - 1))) to++;
  return { ...match, before: source.slice(from, match.from), after: source.slice(match.to, to), clippedBefore: from > 0, clippedAfter: to < source.length };
}

/** Worker-side search: count all results, return only bounded text excerpts to the UI. */
export function searchWorkspace(sheets: readonly SearchSheet[], query: string, options: LiteralSearchOptions = {}): WorkspaceSearchResult {
  const files: SearchFileResult[] = [];
  let totalFiles = 0, totalMatches = 0, unsupportedFiles = 0;
  if (!query) return { files, totalFiles, totalMatches, unsupportedFiles };
  for (const sheet of sheets) {
    if (!/\.md$/i.test(sheet.path) || sheet.path.split(/[\\/]/).some((part) => /^(?:\.slate|\.git)$/i.test(part))) continue;
    const pathMatch = !findLiteralMatches(sheet.path, query, options).next().done;
    let matches = 0;
    const excerpts: SearchExcerpt[] = [];
    if (sheet.unsupportedEncoding) unsupportedFiles++;
    else for (const match of findLiteralMatches(sheet.content, query, options)) {
      matches++;
      if (files.length < 200 && excerpts.length < 3) excerpts.push(excerpt(sheet.content, match));
    }
    if (!matches && !pathMatch) continue;
    totalFiles++; totalMatches += matches;
    if (files.length < 200) files.push({ path: sheet.path, matches, pathMatch, unsupported: !!sheet.unsupportedEncoding, excerpts });
  }
  return { files, totalFiles, totalMatches, unsupportedFiles };
}
