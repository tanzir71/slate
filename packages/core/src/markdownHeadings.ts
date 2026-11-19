import { markdownNodeText, parseMarkdownPreview, type MarkdownPreviewNode } from "./blocks.js";
import { markdownBodyFrom } from "./markdownBody.js";

export interface MarkdownHeading {
  readonly label: string;
  readonly depth: number;
  readonly from: number;
  readonly to: number;
  readonly line: number;
  readonly root: boolean;
}

/** Semantic headings with raw UTF-16 ranges and physical lines, never code/YAML matches. */
export function markdownHeadings(source: string): readonly MarkdownHeading[] {
  const bodyFrom = markdownBodyFrom(source);
  const body = source.slice(bodyFrom);
  // ATX and Setext headings require one of these literal markers. A marker-free
  // body cannot contain a heading, including inside quotes or list containers.
  if (!/[#=-]/.test(body)) return [];
  const before = source.slice(0, bodyFrom).match(/\r\n|\r|\n/g)?.length ?? 0;
  const tree = parseMarkdownPreview(body);
  const headings: MarkdownHeading[] = [];
  function visit(node: MarkdownPreviewNode, root = false) {
    if (node.type === "heading") {
      const from = node.position?.start.offset, to = node.position?.end.offset, line = node.position?.start.line;
      const depth = node.depth ?? 0;
      const label = markdownNodeText(node).replace(/\s+/g, " ").trim();
      if (typeof from === "number" && typeof to === "number" && typeof line === "number" && depth >= 1 && depth <= 6 && label)
        headings.push({ label, depth, from: bodyFrom + from, to: bodyFrom + to, line: before + line, root });
      return;
    }
    for (const child of node.children ?? []) visit(child);
  }
  for (const child of tree.children ?? []) visit(child, true);
  return headings;
}
