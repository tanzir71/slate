import type { TidyNode } from "./source.js";

const words = /^[\p{L}\p{N}\p{M}]+(?: +[\p{L}\p{N}\p{M}]+)*$/u;

/** Exact CommonMark subset: word-only single-line paragraphs and empty lines.
 * Adjacent text lines, indentation, trailing spaces and every syntax character
 * retain the general parser. Positions count UTF-16 code units and physical EOLs.
 */
export function plainParagraphsAst(body: string): TidyNode | undefined {
  if (!/^[\p{L}\p{N}\p{M}\r\n]/u.test(body)) return;
  const lines = body.split(/\r\n|\r|\n/);
  let previousText = false, hasText = false;
  for (const line of lines) {
    if (line && (previousText || !words.test(line))) return;
    previousText = !!line; hasText ||= previousText;
  }
  if (!hasText) return;
  const children: TidyNode[] = [];
  let offset = 0;
  for (const [index, line] of lines.entries()) {
    const start = { line: index + 1, column: 1, offset };
    const end = { line: index + 1, column: line.length + 1, offset: offset + line.length };
    if (line) {
      const position = { start, end };
      children.push({ type: "paragraph", children: [{ type: "text", value: line, position }], position });
    }
    offset = end.offset + (body.startsWith("\r\n", end.offset) ? 2 : end.offset < body.length ? 1 : 0);
  }
  return {
    type: "root", children,
    position: {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: lines.length, column: lines.at(-1)!.length + 1, offset: body.length },
    },
  };
}
