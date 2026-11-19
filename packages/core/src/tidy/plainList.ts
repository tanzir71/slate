import type { TidyNode } from "./source.js";

const words = /^[\p{L}\p{N}\p{M}]+(?: +[\p{L}\p{N}\p{M}]+)*$/u;

/** Exact CommonMark subset: one tight, unindented, homogeneous bullet list.
 * Words/numbers cannot introduce inline or block syntax. Any other character,
 * blank line, continuation, indentation or marker change uses the full parser.
 */
export function plainListAst(body: string): TidyNode | undefined {
  const marker = body[0];
  if (!marker || !"-+*".includes(marker) || body[1] !== " ") return;
  const lines = body.split(/\r\n|\r|\n/);
  const finalNewline = lines.at(-1) === "";
  if (finalNewline) lines.pop();
  if (lines.some((line) => line[0] !== marker || line[1] !== " " || !words.test(line.slice(2)))) return;

  const children: TidyNode[] = [];
  let offset = 0;
  for (const [index, line] of lines.entries()) {
    const start = { line: index + 1, column: 1, offset };
    const textStart = { line: index + 1, column: 3, offset: offset + 2 };
    const end = { line: index + 1, column: line.length + 1, offset: offset + line.length };
    const position = { start: textStart, end };
    children.push({
      type: "listItem", spread: false, checked: null,
      children: [{ type: "paragraph", children: [{ type: "text", value: line.slice(2), position }], position }],
      position: { start, end },
    });
    offset = end.offset + (body.startsWith("\r\n", end.offset) ? 2 : 1);
  }
  const start = { line: 1, column: 1, offset: 0 };
  const end = children.at(-1)!.position!.end;
  return {
    type: "root",
    children: [{ type: "list", ordered: false, start: null, spread: false, children, position: { start, end } }],
    position: { start, end: finalNewline ? { line: lines.length + 1, column: 1, offset: body.length } : end },
  };
}
