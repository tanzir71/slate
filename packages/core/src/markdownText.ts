import { parseMarkdownPreview, type MarkdownPreviewNode } from "./blocks.js";

export interface MarkdownTextRange { readonly from: number; readonly to: number }
const excluded = new Set(["code", "inlineCode", "link", "linkReference", "image", "imageReference", "definition"]);
const inlineBlocks = new Set(["paragraph", "heading", "tableCell"]);
const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
function htmlTag(value: string, stack: string[]) {
  const tag = /^<\/?([A-Za-z][\w:-]*)(?:\s|\/?>)/.exec(value)?.[1]?.toLowerCase();
  if (!tag) return;
  if (value.startsWith("</")) {
    const at = stack.lastIndexOf(tag); if (at >= 0) stack.splice(at);
  } else if (!/\/\s*>$/.test(value) && !voidTags.has(tag)) stack.push(tag);
}
/** Raw prose positions shared by wiki-reference metadata and guarded mention plans. */
export function markdownTextRanges(source: string, bodyFrom: number): readonly MarkdownTextRange[] {
  const ranges: MarkdownTextRange[] = [];
  function visit(node: MarkdownPreviewNode, inherited: string[]) {
    if (excluded.has(node.type)) return;
    const stack = inlineBlocks.has(node.type) ? [] : inherited;
    if (node.type === "html") { htmlTag(node.value ?? "", stack); return; }
    const from = node.position?.start.offset, to = node.position?.end.offset;
    if (node.type === "text" && !stack.length && typeof from === "number" && typeof to === "number")
      ranges.push({ from: bodyFrom + from, to: bodyFrom + to });
    else for (const child of node.children ?? []) visit(child, stack);
  }
  visit(parseMarkdownPreview(source.slice(bodyFrom)), []);
  return ranges;
}
