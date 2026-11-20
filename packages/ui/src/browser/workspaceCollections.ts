import type { SheetDocument } from "@slate/core";
import { matchesWorkspaceFilter } from "./workspaceFilter";

/** Count each file under every exact notebook ancestor without rescanning branches. */
export function notebookCounts(paths: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const path of paths)
    for (let slash = path.indexOf("/"); slash >= 0; slash = path.indexOf("/", slash + 1)) {
      const parent = path.slice(0, slash);
      counts.set(parent, (counts.get(parent) ?? 0) + 1);
    }
  return counts;
}

/** A note with both a parent and child tag still counts once for that parent. */
export function workspaceTagSummary(documents: readonly Pick<SheetDocument, "tags">[]): { tags: readonly string[]; counts: ReadonlyMap<string, number> } {
  const tags = new Set<string>(), counts = new Map<string, number>();
  for (const document of documents) {
    const seen = new Set<string>();
    for (const tag of document.tags) {
      const path = tag.path;
      tags.add(path); seen.add(path);
      for (let slash = path.indexOf("/"); slash >= 0; slash = path.indexOf("/", slash + 1)) seen.add(path.slice(0, slash));
    }
    for (const path of seen) counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return { tags: [...tags].sort(), counts };
}

export function filterWorkspaceDocuments(documents: readonly SheetDocument[], filter: string, pinned: readonly string[], query: string, matches: readonly string[] | undefined, now?: Date): readonly SheetDocument[] {
  if (!filter && !query) return documents;
  const text = query.toLowerCase(), paths = query && matches !== undefined ? new Set(matches) : undefined;
  return documents.filter(sheet => matchesWorkspaceFilter(sheet, filter, pinned, now) &&
    (!query || (paths ? paths.has(sheet.path) : `${sheet.title} ${sheet.raw}`.toLowerCase().includes(text))));
}
