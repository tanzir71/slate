import type { TextChange } from "../textChanges.js";
import {
  blankLine,
  replaceIfDifferent,
  type RuleContext,
} from "./ruleContext.js";
import { isProtected, nodeRange } from "./source.js";

export function whitespaceRules(context: RuleContext) {
  const { document, configuration } = context;
  const breaks = document.visits.flatMap(({ node }) =>
    node.type === "break"
      ? [nodeRange(document, node)].filter((range) => range !== undefined)
      : [],
  );
  let blankStart = -1;
  for (const line of document.lines) {
    if (line.from < document.bodyFrom) {
      blankStart = -1;
      continue;
    }
    const trailing = /[ \t]+$/.exec(line.text);
    if (
      trailing &&
      !isProtected(document, line.from + trailing.index, line.to)
    ) {
      const from = line.from + trailing.index,
        isBreak = breaks.some(
          (range) => range.from >= from && range.from <= line.to,
        );
      const text = isBreak ? (configuration.keepHardBreaks ? "  " : "\\") : "";
      replaceIfDifferent(
        context,
        "trailing-space",
        from,
        line.to,
        text,
        "Remove trailing whitespace while retaining intentional line breaks.",
      );
    }
    for (const match of line.text.matchAll(/\t/g)) {
      const from = line.from + match.index;
      if (!isProtected(document, from, from + 1))
        context.add(
          "no-hard-tabs",
          from,
          "Use spaces outside literal code and protected data.",
          [{ from, to: from + 1, text: "  " }],
        );
    }
    if (
      blankLine(line) &&
      !line.text.includes(">") &&
      !isProtected(document, line.from, Math.max(line.next, line.from + 1))
    ) {
      if (blankStart < 0) blankStart = line.index;
      else if (line.next > line.from)
        context.add("multiple-blanks", line.from, "Keep one blank line.", [
          { from: line.from, to: line.next, text: "" },
        ]);
    } else blankStart = -1;
  }
  if (document.source.slice(document.bodyFrom).length) {
    const tail = /(?:\r\n|\n|\r)*$/.exec(document.source)![0];
    const from = document.source.length - tail.length;
    replaceIfDifferent(
      context,
      "final-newline",
      from,
      document.source.length,
      document.eol,
      "End the document with one newline.",
    );
  }
}

/** Deduplicate matching boundaries before a rule's changes are submitted together. */
export function uniqueChanges(
  changes: readonly Readonly<TextChange>[],
): TextChange[] {
  const seen = new Set<string>();
  return changes
    .flatMap((change) => {
      const key = JSON.stringify(change);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ ...change }];
    })
    .sort((a, b) => a.from - b.from || a.to - b.to);
}
