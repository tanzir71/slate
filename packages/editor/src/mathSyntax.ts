import type { Line, MarkdownConfig } from "@lezer/markdown";
import { inlineMathSpan } from "@slate/core";

function fence(line: Line): number {
  if (line.next !== 36 || line.indent - line.baseIndent >= 4) return 0;
  return /^(\${2,})[\t ]*$/.exec(line.text.slice(line.pos))?.[1]?.length ?? 0;
}

export const mathSyntax: MarkdownConfig = {
  defineNodes: [{ name: "SlateMathBlock", block: true }, "SlateMathInline", "SlateMathMark", "SlateMathText"],
  parseBlock: [{
    name: "SlateMathBlock", before: "FencedCode",
    endLeaf(_context, line) { return fence(line) > 0; },
    parse(context, line) {
      const width = fence(line); if (!width) return false;
      const from = context.lineStart + line.pos, depth = context.depth;
      const children = [context.elt("SlateMathMark", from, from + width)];
      let to = context.lineStart + line.text.length;
      while (context.nextLine()) {
        // The pinned Lezer 1.7.1 uses Line.depth for composite continuation, as its code-fence parser does.
        // Fail closed if that internal field changes, rather than consuming text outside a quote/list.
        const continuedDepth: unknown = Reflect.get(line, "depth");
        if (typeof continuedDepth !== "number" || continuedDepth < depth) break;
        children.push(...line.markers);
        to = context.lineStart + line.text.length;
        const closing = fence(line);
        if (closing >= width) {
          children.push(context.elt("SlateMathMark", context.lineStart + line.pos, context.lineStart + line.pos + closing));
          context.nextLine(); break;
        }
        const start = context.lineStart + line.basePos;
        children.push(context.elt("SlateMathText", start, to));
      }
      context.addElement(context.elt("SlateMathBlock", from, to, children)); return true;
    },
  }],
  parseInline: [{
    name: "SlateMathInline", before: "Emphasis",
    parse(context, next, position) {
      if (next !== 36) return -1;
      const span = inlineMathSpan(context, position); if (!span) return -1;
      return context.addElement(context.elt("SlateMathInline", span.from, span.to, [
        context.elt("SlateMathMark", span.from, span.from + span.width),
        context.elt("SlateMathText", span.from + span.width, span.to - span.width),
        context.elt("SlateMathMark", span.to - span.width, span.to),
      ]));
    },
  }],
};
