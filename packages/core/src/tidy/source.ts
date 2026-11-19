import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { markdownBodyFrom } from "../markdownBody.js";

interface Point {
  readonly line: number;
  readonly column: number;
  readonly offset?: number | undefined;
}
export interface TidyNode {
  readonly type: string;
  readonly position?:
    { readonly start: Point; readonly end: Point } | undefined;
  readonly children?: readonly TidyNode[] | undefined;
  readonly depth?: number | undefined;
  readonly ordered?: boolean | null | undefined;
  readonly start?: number | null | undefined;
  readonly value?: string | undefined;
  readonly lang?: string | null | undefined;
  readonly url?: string | undefined;
  readonly align?: readonly (string | null)[] | null | undefined;
}
export interface TidyLine {
  readonly index: number;
  readonly from: number;
  readonly to: number;
  readonly next: number;
  readonly text: string;
}
export interface TidyRange {
  readonly from: number;
  readonly to: number;
}
export interface TidyVisit {
  readonly node: TidyNode;
  readonly parents: readonly TidyNode[];
}
export interface TidyDocument {
  readonly source: string;
  readonly bodyFrom: number;
  readonly body: string;
  readonly root: TidyNode;
  readonly eol: string;
  readonly lines: readonly TidyLine[];
  readonly visits: readonly TidyVisit[];
  readonly protectedRanges: readonly TidyRange[];
}
const parser = /* @__PURE__ */ unified()
  .use(remarkParse)
  .use(remarkGfm)
  .freeze();
const commonmarkParser = /* @__PURE__ */ unified().use(remarkParse).freeze();
export function parseTidyAst(body: string): TidyNode {
  // GFM additions require brackets, pipes, tildes, HTML, or autolink candidates.
  // Escapes/entities can produce such candidates during decoding, so keep GFM
  // for them too. All other input has the identical CommonMark syntax tree.
  return /[@:|~<\\&]/.test(body) || body.includes("[") || /www\./i.test(body)
    ? parser.parse(body)
    : commonmarkParser.parse(body);
}
function sourceLines(source: string): TidyLine[] {
  const lines: TidyLine[] = [];
  let from = 0;
  do {
    let to = from;
    while (to < source.length && source[to] !== "\n" && source[to] !== "\r")
      to++;
    const next =
      to + (source.startsWith("\r\n", to) ? 2 : to < source.length ? 1 : 0);
    lines.push({
      index: lines.length,
      from,
      to,
      next,
      text: source.slice(from, to),
    });
    if (next === from || next === to) break;
    from = next;
  } while (from <= source.length);
  return lines;
}
export function nodeRange(
  document: Pick<TidyDocument, "bodyFrom">,
  node: TidyNode,
): TidyRange | undefined {
  const from = node.position?.start.offset,
    to = node.position?.end.offset;
  return from === undefined || to === undefined
    ? undefined
    : { from: document.bodyFrom + from, to: document.bodyFrom + to };
}
export function parseTidyDocument(source: string): TidyDocument {
  const bodyFrom = markdownBodyFrom(source),
    body = source.slice(bodyFrom),
    root = parseTidyAst(body);
  const visits: TidyVisit[] = [],
    protectedRanges: TidyRange[] = bodyFrom ? [{ from: 0, to: bodyFrom }] : [];
  function visit(node: TidyNode, parents: readonly TidyNode[]) {
    visits.push({ node, parents });
    if (["code", "inlineCode", "html"].includes(node.type)) {
      const range = nodeRange({ bodyFrom }, node);
      if (range) protectedRanges.push(range);
    }
    for (const child of node.children ?? []) visit(child, [...parents, node]);
  }
  visit(root, []);
  for (const match of body.matchAll(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g))
    protectedRanges.push({
      from: bodyFrom + match.index,
      to: bodyFrom + match.index + match[0].length,
    });
  protectedRanges.sort((a, b) => a.from - b.from || a.to - b.to);
  return {
    source,
    bodyFrom,
    body,
    root,
    eol: source.match(/\r\n|\n|\r/)?.[0] ?? "\n",
    lines: sourceLines(source),
    visits,
    protectedRanges,
  };
}
export function lineAt(
  document: Pick<TidyDocument, "lines">,
  offset: number,
): TidyLine {
  let low = 0,
    high = document.lines.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (document.lines[mid]!.from <= offset) low = mid;
    else high = mid - 1;
  }
  return document.lines[low]!;
}
export function isProtected(
  document: Pick<TidyDocument, "protectedRanges">,
  from: number,
  to: number,
): boolean {
  return document.protectedRanges.some(
    (range) => range.from < to && range.to > from,
  );
}
