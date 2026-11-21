import type { Line, MarkdownConfig } from "@lezer/markdown";

// Keep the same bounded, non-whitespace labels for references and definitions.
const label = /^\[\^((?:\\[^\s]|[^\s[\]\\]){1,999})\]/;
function matchLabel(source: string): RegExpExecArray | null {
  const match = label.exec(source);
  return match && match[1]!.length <= 999 ? match : null;
}
export function footnoteLabel(source: string): string | undefined { return matchLabel(source)?.[1]; }
export function displayFootnoteLabel(source: string): string {
  return source.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1");
}
export function normalizedFootnoteLabel(source: string): string {
  return displayFootnoteLabel(source).toUpperCase().toLowerCase();
}
function definition(line: Line): RegExpExecArray | null {
  if (line.indent - line.baseIndent >= 4 || line.next !== 91) return null;
  const match = matchLabel(line.text.slice(line.pos, line.pos + 2004));
  return match && line.text[line.pos + match[0].length] === ":" ? match : null;
}

export const footnoteSyntax: MarkdownConfig = {
  defineNodes: ["SlateFootnote", "SlateFootnoteLabel", {
    name: "SlateFootnoteDefinition", block: true,
    composite(_context, line) {
      if (line.pos === line.text.length) return true;
      if (line.indent < line.baseIndent + 4) return false;
      line.moveBaseColumn(line.baseIndent + 4); return true;
    },
  }],
  parseBlock: [{
    name: "SlateFootnoteDefinition", before: "LinkReference",
    endLeaf(_context, line) { return !!definition(line); },
    parse(context, line) {
      const match = definition(line);
      if (!match) return false;
      const from = context.lineStart + line.pos, end = line.pos + match[0].length + 1;
      context.startComposite("SlateFootnoteDefinition", line.pos);
      context.addElement(context.elt("SlateFootnoteLabel", from, context.lineStart + end));
      line.moveBase(line.skipSpace(end)); return null;
    },
  }],
  parseInline: [{
    name: "SlateFootnote", before: "Link",
    parse(context, next, position) {
      if (next !== 91 || context.char(position + 1) !== 94) return -1;
      const match = matchLabel(context.slice(position, Math.min(context.end, position + 2004)));
      return match ? context.addElement(context.elt("SlateFootnote", position, position + match[0].length)) : -1;
    },
  }],
};
