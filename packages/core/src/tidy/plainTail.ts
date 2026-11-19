import type { TidyNode } from "./source.js";

const words = /^[\p{L}\p{N}\p{M}]+(?: +[\p{L}\p{N}\p{M}]+)*$/u;

/** A large, single-line final paragraph containing only Unicode words and spaces.
 * Parse the complete prefix with one plain character in its place. Proceed only
 * if full GFM proves that character is a separate root paragraph/text node.
 * Lists, quotes, code, HTML, definitions and merged paragraphs retain the parser.
 */
export function plainTailAst(body: string, parse: (source: string) => TidyNode): TidyNode | undefined {
  const ending = body.endsWith("\r\n") ? 2 : /[\r\n]$/.test(body) ? 1 : 0;
  const to = body.length - ending;
  const from = Math.max(body.lastIndexOf("\n", to - 1), body.lastIndexOf("\r", to - 1)) + 1;
  // Bound speculative work: the tail must be substantial and dominate its prefix.
  if (to - from < 4096 || from > (to - from) / 4) return;
  const tail = body.slice(from, to);
  if (!words.test(tail)) return;
  const root = parse(body.slice(0, from) + "A" + body.slice(to));
  const paragraph = root.children?.at(-1);
  const text = paragraph?.children?.[0];
  if (!root.position || !paragraph?.position || !text?.position ||
      paragraph.type !== "paragraph" || paragraph.children?.length !== 1 || text.type !== "text" || text.value !== "A" ||
      paragraph.position.start.offset !== from || paragraph.position.end.offset !== from + 1 ||
      text.position.start.offset !== from || text.position.end.offset !== from + 1 || text.position.start.column !== 1) return;
  const end = { ...text.position.end, column: tail.length + 1, offset: to };
  const textPosition = { start: text.position.start, end };
  const updated = {
    ...paragraph, position: { start: paragraph.position.start, end },
    children: [{ ...text, value: tail, position: textPosition }],
  };
  return {
    ...root, children: [...root.children!.slice(0, -1), updated],
    position: { start: root.position.start, end: ending ? { ...root.position.end, offset: body.length } : end },
  };
}
