import { parseMarkdownPreview, type MarkdownPreviewNode } from "../blocks.js";
import { inlineMathSpan } from "../markdownMath.js";
import type { TidyDocument, TidyNode, TidyRange } from "./source.js";

const empty: readonly TidyRange[] = [];
function bounds(node: TidyNode | MarkdownPreviewNode | undefined, offset: number): TidyRange | undefined {
  const from = node?.position?.start.offset, to = node?.position?.end.offset;
  return from === undefined || to === undefined ? undefined : { from: offset + from, to: offset + to };
}
function merged(ranges: readonly TidyRange[]): TidyRange[] {
  const result: TidyRange[] = [];
  for (const range of [...ranges].filter(range => range.from < range.to).sort((a, b) => a.from - b.from || a.to - b.to)) {
    const last = result.at(-1);
    if (last && last.to >= range.from) result[result.length - 1] = { from: last.from, to: Math.max(last.to, range.to) };
    else result.push(range);
  }
  return result;
}
function containing(ranges: readonly TidyRange[], position: number): TidyRange | undefined {
  let low = 0, high = ranges.length;
  while (low < high) { const mid = (low + high) >>> 1; if (ranges[mid]!.from <= position) low = mid + 1; else high = mid; }
  const range = ranges[low - 1]; return range && position < range.to ? range : undefined;
}

/** Overlay literal math ranges while retaining the established GFM tree used by formatting rules. */
export function mathSourceRanges(document: Pick<TidyDocument, "source" | "bodyFrom" | "body" | "root">): readonly TidyRange[] {
  const { source, body, bodyFrom, root } = document;
  if (!body.includes("$")) return empty;
  const result: TidyRange[] = [], excluded: TidyRange[] = [], inline: TidyRange[] = [];
  if (body.includes("$$")) {
    const collect = (node: MarkdownPreviewNode) => {
      const range = bounds(node, bodyFrom);
      if (node.type === "math" && range) result.push(range);
      else for (const child of node.children ?? []) collect(child);
    };
    collect(parseMarkdownPreview(body));
  }
  const collect = (node: TidyNode) => {
    const range = bounds(node, bodyFrom);
    if (range) {
      if (["code", "inlineCode", "html", "image", "imageReference"].includes(node.type)) { excluded.push(range); return; }
      if (["paragraph", "heading", "tableCell"].includes(node.type)) inline.push(range);
      if (node.type === "link" || node.type === "linkReference") {
        const first = bounds(node.children?.[0], bodyFrom), last = bounds(node.children?.at(-1), bodyFrom);
        if (source[range.from] === "[" && first && last) excluded.push({ from: range.from, to: first.from }, { from: last.to, to: range.to });
        else excluded.push(range);
      }
    }
    for (const child of node.children ?? []) collect(child);
  };
  collect(root);
  for (const match of body.matchAll(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) excluded.push({ from: bodyFrom + match.index, to: bodyFrom + match.index + match[0].length });
  const skip = merged([...excluded, ...result]);
  for (const range of inline) {
    const text = { end: range.to, char: (at: number) => at < range.to ? source.charCodeAt(at) : -1,
      slice: (from: number, to: number) => source.slice(from, Math.min(to, range.to)) };
    let position = source.indexOf("$", range.from);
    while (position >= 0 && position < range.to) {
      const blocked = containing(skip, position);
      if (blocked) { position = source.indexOf("$", blocked.to); continue; }
      const span = inlineMathSpan(text, position);
      if (span) result.push({ from: span.from, to: span.to });
      position = source.indexOf("$", span?.to ?? position + 1);
    }
  }
  return result.sort((a, b) => a.from - b.from || a.to - b.to);
}
