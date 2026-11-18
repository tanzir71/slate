import { parseMarkdownPreview } from "./blocks.js";
import { markdownBoundary } from "./markdownBoundary.js";
import type { TextChange } from "./textChanges.js";

export interface MarkdownSourceBlock {
  readonly from: number;
  readonly to: number;
  readonly kind: string;
  readonly label: string;
}
export interface MarkdownBlockDocument {
  readonly source: string;
  readonly bodyFrom: number;
  readonly blocks: readonly MarkdownSourceBlock[];
}
function lineEnd(source: string, from: number): number {
  let end = from;
  while (end < source.length && source[end] !== "\r" && source[end] !== "\n")
    end++;
  return end;
}
function afterLine(source: string, end: number): number {
  return (
    end + (source.startsWith("\r\n", end) ? 2 : end < source.length ? 1 : 0)
  );
}
/** Metadata stays at the beginning, even when unfinished or not valid YAML. */
function bodyFrom(source: string): number {
  const opening = /^\uFEFF?---[ \t]*(?:\r\n|\n|\r|$)/.exec(source);
  if (!opening) return source.startsWith("\uFEFF") ? 1 : 0;
  let position = opening[0].length;
  while (position < source.length) {
    const end = lineEnd(source, position);
    if (/^(?:---|\.\.\.)[ \t]*$/.test(source.slice(position, end)))
      return afterLine(source, end);
    position = afterLine(source, end);
  }
  return source.length;
}
const labels: Readonly<Record<string, string>> = {
  paragraph: "Paragraph",
  heading: "Heading",
  list: "List",
  blockquote: "Quote",
  code: "Code block",
  table: "Table",
  html: "HTML block",
  thematicBreak: "Divider",
  definition: "Link reference",
  footnoteDefinition: "Footnote",
};
/** Source ranges are resolved only for explicit block interactions, never typing. */
export function scanMarkdownBlocks(source: string): MarkdownBlockDocument {
  const start = bodyFrom(source);
  const blocks: MarkdownSourceBlock[] = [];
  for (const node of parseMarkdownPreview(source.slice(start)).children ?? []) {
    const begin = node.position?.start.offset,
      end = node.position?.end.offset;
    if (begin === undefined || end === undefined) continue;
    const from = start + begin;
    blocks.push({
      from: Math.max(
        start,
        Math.max(
          source.lastIndexOf("\n", from - 1),
          source.lastIndexOf("\r", from - 1),
        ) + 1,
      ),
      to: lineEnd(source, start + end),
      kind: node.type,
      label:
        node.type === "heading"
          ? "Heading " + node.depth
          : (labels[node.type] ?? "Markdown block"),
    });
  }
  return { source, bodyFrom: start, blocks };
}
export interface MarkdownBlockMove {
  readonly changes: readonly TextChange[];
  readonly selection: { readonly anchor: number; readonly head: number };
}
/** Move before a block index; blocks.length means the end of the body. */
export function planMarkdownBlockMove(
  document: MarkdownBlockDocument,
  index: number,
  before: number,
): MarkdownBlockMove | undefined {
  const { source, blocks } = document;
  if (
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(before) ||
    index < 0 ||
    index >= blocks.length ||
    before < 0 ||
    before > blocks.length
  )
    throw new RangeError("Invalid block move.");
  if (index === before || index + 1 === before) return;
  const block = blocks[index]!;
  const next = blocks[index + 1],
    previous = blocks[index - 1];
  const from = !next && previous ? previous.to : block.from;
  const to = next ? next.from : block.to;
  const destination =
    before < blocks.length ? blocks[before]!.from : blocks.at(-1)!.to;
  const remaining = source.slice(0, from) + source.slice(to);
  const position = destination >= to ? destination - (to - from) : destination;
  const prefix = remaining.slice(0, position),
    suffix = remaining.slice(position);
  const payload = source.slice(block.from, block.to);
  if (
    position === document.bodyFrom &&
    document.bodyFrom <= 1 &&
    /^---[ \t]*$/.test(payload)
  )
    return;
  const eol = source.match(/\r\n|\n|\r/)?.[0] ?? "\n";
  const leading = prefix.trim() ? markdownBoundary(prefix, payload, eol) : "";
  const trailing = suffix.trim() ? markdownBoundary(payload, suffix, eol) : "";
  return {
    changes: [
      { from, to, text: "" },
      {
        from: destination,
        to: destination,
        text: leading + payload + trailing,
      },
    ].sort((left, right) => left.from - right.from),
    selection: {
      anchor: position + leading.length,
      head: position + leading.length + payload.length,
    },
  };
}
