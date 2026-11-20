import { createWikiPathIndex, markdownHeadings, resolveWikiPath, type MarkdownHeading, type SheetDocument, type WikiLink } from "@slate/core";

export interface InspectorBacklink {
  readonly document: SheetDocument;
  readonly count: number;
  readonly snippet: { readonly before: string; readonly label: string; readonly after: string };
}
export interface InspectorContents {
  readonly outline: readonly MarkdownHeading[];
  readonly backlinks: readonly InspectorBacklink[];
}
const empty: InspectorContents = { outline: [], backlinks: [] };
const squash = (text: string) => text.replace(/\s+/g, " ");

function snippet(document: SheetDocument, link: WikiLink): InspectorBacklink["snippet"] {
  const at = typeof link.from === "number" && typeof link.to === "number" && document.body.slice(link.from, link.to) === link.raw ? link.from : document.body.indexOf(link.raw);
  if (at < 0) return { before: "", label: link.display || document.title, after: "" };
  const end = at + link.raw.length;
  const lineFrom = Math.max(document.body.lastIndexOf("\n", at - 1), document.body.lastIndexOf("\r", at - 1)) + 1;
  const nextLine = document.body.slice(end).search(/[\r\n]/), lineTo = nextLine < 0 ? document.body.length : end + nextLine;
  const from = Math.max(lineFrom, at - 48), to = Math.min(lineTo, end + 64);
  return { before: (from > lineFrom ? "…" : "") + squash(document.body.slice(from, at)).trimStart(), label: link.display || link.target,
    after: squash(document.body.slice(end, to)).trimEnd() + (to < lineTo ? "…" : "") };
}

/** The closed panel reads no document data. Live app outlines already come from the summary worker. */
export function inspectorContents(open: boolean, selected: SheetDocument | undefined, documents: readonly SheetDocument[]): InspectorContents {
  if (!open || !selected) return empty;
  const paths = createWikiPathIndex(documents), ids = new Map<string, SheetDocument>(), titles = new Map<string, SheetDocument>();
  for (const document of documents) {
    ids.set(document.id.toLowerCase(), document);
    if (!titles.has(document.title.toLowerCase())) titles.set(document.title.toLowerCase(), document);
  }
  const resolve = (link: WikiLink) => link.targetId ? ids.get(link.targetId.toLowerCase())
    : resolveWikiPath(paths, link.target) ?? titles.get(link.target.toLowerCase());
  const backlinks: InspectorBacklink[] = [];
  for (const document of documents) {
    if (document.path === selected.path) continue;
    const links = document.links.filter((link) => resolve(link)?.path === selected.path);
    if (links.length) backlinks.push({ document, count: links.length, snippet: snippet(document, links[0]!) });
  }
  return { outline: (selected.headings ?? markdownHeadings(selected.raw)).filter((heading) => heading.root), backlinks };
}

/** Keyboard moves keep a section beside siblings at its current depth and carry every child. */
export function outlineMoveBefore(outline: readonly MarkdownHeading[], index: number, direction: "up" | "down"): number | undefined {
  const heading = outline[index];
  if (!heading) return;
  const end = (start: number) => {
    let next = start + 1;
    while (next < outline.length && outline[next]!.depth > outline[start]!.depth) next++;
    return next;
  };
  if (direction === "down") {
    const next = end(index);
    return outline[next]?.depth === heading.depth ? end(next) : undefined;
  }
  let previous = index - 1;
  while (previous >= 0 && outline[previous]!.depth > heading.depth) previous--;
  return outline[previous]?.depth === heading.depth ? previous : undefined;
}
