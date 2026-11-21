import { GFM, type MarkdownConfig } from "@lezer/markdown";
import { footnoteSyntax } from "./footnoteSyntax.js";

const highlight = { resolve: "SlateHighlight", mark: "SlateHighlightMark" };
export const slateInlineSyntax: MarkdownConfig = {
  defineNodes: [
    "SlateHighlight",
    "SlateHighlightMark",
    "SlateWikiLink",
    "SlateWikiMark",
    "SlateWikiTarget",
    "SlateWikiLabel",
    "SlateTag",
  ],
  parseInline: [
    {
      name: "SlateHighlight",
      after: "Emphasis",
      parse(context, next, position) {
        if (
          next !== 61 ||
          context.char(position - 1) === 61 ||
          context.char(position + 1) !== 61 ||
          context.char(position + 2) === 61
        )
          return -1;
        const before = context.slice(position - 1, position);
        const after = context.slice(position + 2, position + 3);
        return context.addDelimiter(
          highlight,
          position,
          position + 2,
          !!after && !/\s/.test(after),
          !!before && !/\s/.test(before),
        );
      },
    },
    {
      name: "SlateWikiLink",
      before: "Link",
      parse(context, next, position) {
        if (next !== 91 || context.char(position + 1) !== 91) return -1;
        let end = position + 2;
        while (
          end < context.end &&
          context.char(end) !== 10 &&
          !(context.char(end) === 93 && context.char(end + 1) === 93)
        )
          end++;
        if (end >= context.end || context.char(end) === 10) return -1;
        const pipe = context.slice(position + 2, end).indexOf("|");
        const targetEnd = pipe < 0 ? end : position + 2 + pipe;
        if (!context.slice(position + 2, targetEnd).trim()) return -1;
        const children = [
          context.elt("SlateWikiMark", position, position + 2),
          context.elt("SlateWikiTarget", position + 2, targetEnd),
        ];
        if (pipe >= 0)
          children.push(
            context.elt("SlateWikiMark", targetEnd, targetEnd + 1),
            context.elt("SlateWikiLabel", targetEnd + 1, end),
          );
        children.push(context.elt("SlateWikiMark", end, end + 2));
        return context.addElement(
          context.elt("SlateWikiLink", position, end + 2, children),
        );
      },
    },
    {
      name: "SlateTag",
      after: "Link",
      parse(context, next, position) {
        if (
          next !== 35 ||
          (position > 0 &&
            !/[\s([>]/.test(context.slice(position - 1, position)))
        )
          return -1;
        const match =
          /^#[A-Za-z0-9][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)*/.exec(
            context.slice(position, context.end),
          );
        return match
          ? context.addElement(
              context.elt("SlateTag", position, position + match[0].length),
            )
          : -1;
      },
    },
  ],
};
export const slateMarkdownSyntax = [GFM, slateInlineSyntax, footnoteSyntax];
