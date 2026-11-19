import type { TextChange } from "../textChanges.js";
import {
  blankLine,
  nodeLines,
  quotePrefix,
  replaceIfDifferent,
  type RuleContext,
} from "./ruleContext.js";
import { isProtected, lineAt, nodeRange, type TidyNode } from "./source.js";

function around(
  context: RuleContext,
  node: TidyNode,
  rule:
    "blanks-around-headings" | "blanks-around-lists" | "blanks-around-fences",
) {
  const { document } = context,
    lines = nodeLines(document, node),
    first = lines[0],
    last = lines.at(-1);
  if (!first || !last) return;
  const prefix = /^(?:[ \t]{0,3}>[ \t]?)+/.exec(first.text)?.[0] ?? "";
  const previous = document.lines[first.index - 1],
    next = document.lines[last.index + 1];
  if (previous && previous.from >= document.bodyFrom && !blankLine(previous))
    context.add(rule, first.from, "Add a blank line before this block.", [
      { from: first.from, to: first.from, text: prefix + document.eol },
    ]);
  if (next && next.from < document.source.length && !blankLine(next))
    context.add(rule, last.next, "Add a blank line after this block.", [
      { from: last.next, to: last.next, text: prefix + document.eol },
    ]);
}
function listMarkers(context: RuleContext, node: TidyNode) {
  const { document } = context;
  for (const [index, item] of (node.children ?? []).entries()) {
    const range = nodeRange(document, item);
    if (!range) continue;
    const marker = /^([*+-]|\d+[.)])([ \t]+|$)/.exec(
      document.source.slice(range.from, lineAt(document, range.from).to),
    );
    if (!marker) continue;
    const raw = marker[1]!,
      space = marker[2]!,
      after = range.from + raw.length;
    if (!node.ordered)
      replaceIfDifferent(
        context,
        "list-marker",
        range.from,
        after,
        "-",
        "Use a consistent bullet marker.",
      );
    else
      replaceIfDifferent(
        context,
        "ol-prefix",
        range.from,
        after,
        `${(node.start ?? 1) + index}${raw.at(-1)}`,
        "Renumber ordered items without changing the list's start.",
      );
    if (space.length)
      replaceIfDifferent(
        context,
        "list-marker-space",
        after,
        after + space.length,
        " ",
        "Use one space after a list marker.",
      );
  }
}

function listIndentation(context: RuleContext) {
  const { document } = context,
    planned = new Map<number, TextChange>();
  const target = new Map<TidyNode, number>(),
    quoteDepth = new Map<TidyNode, number>();
  for (const { node, parents } of document.visits) {
    if (node.type !== "list") continue;
    const range = nodeRange(document, node);
    if (!range) continue;
    const first = lineAt(document, range.from),
      prefix = document.source
        .slice(first.from, range.from)
        .replace(/^\uFEFF/, ""),
      leading = prefix.slice(quotePrefix(prefix).length),
      depth = parents.filter((parent) => parent.type === "blockquote").length;
    if (!/^ *$/.test(leading)) continue;
    const ancestors = [...parents].reverse();
    const parentList = ancestors.find(
        (parent) => parent.type === "list" && quoteDepth.get(parent) === depth,
      ),
      parentItem = ancestors.find((parent) => parent.type === "listItem");
    let expected = 0;
    if (parentList && parentItem) {
      const parentRange = nodeRange(document, parentItem);
      if (!parentRange) continue;
      const parentMarker = /^(?:[*+-]|\d+[.)])/.exec(
        document.source.slice(parentRange.from),
      );
      expected =
        (target.get(parentList) ?? 0) + (parentMarker?.[0].length ?? 1) + 1;
    }
    target.set(node, expected);
    quoteDepth.set(node, depth);
    const delta = expected - leading.length;
    for (const line of nodeLines(document, node)) {
      if (blankLine(line)) continue;
      const bom = line.text.startsWith("\uFEFF") ? 1 : 0;
      const from = line.from + bom + quotePrefix(line.text.slice(bom)).length;
      const indent = /^ */.exec(document.source.slice(from, line.to))![0];
      const text = " ".repeat(Math.max(0, indent.length + delta));
      planned.set(line.index, { from, to: from + indent.length, text });
    }
  }
  const changes = [...planned.values()]
    .filter(({ from, to, text }) => document.source.slice(from, to) !== text)
    .sort((a, b) => a.from - b.from);
  if (changes.length)
    context.add(
      "list-indent",
      changes[0]!.from,
      "Use two-space nested bullets and preserve ordered-list hanging indents.",
      changes,
    );
}

export function blockRules(context: RuleContext) {
  const { document } = context;
  let previousDepth = 0;
  for (const { node, parents } of document.visits) {
    const range = nodeRange(document, node);
    if (!range) continue;
    if (node.type === "heading") {
      const line = lineAt(document, range.from),
        bom = line.text.startsWith("\uFEFF") ? 1 : 0,
        from = line.from + bom + quotePrefix(line.text.slice(bom)).length,
        prefix = document.source.slice(from, range.from),
        marker = /^(#{1,6})([ \t]+)/.exec(document.source.slice(range.from));
      if (/^ *$/.test(prefix) && prefix.length)
        replaceIfDifferent(
          context,
          "heading-start-left",
          from,
          range.from,
          "",
          "Start a heading at the left edge.",
        );
      if (marker)
        replaceIfDifferent(
          context,
          "heading-space",
          range.from + marker[1]!.length,
          range.from + marker[0].length,
          " ",
          "Use one space after heading markers.",
        );
      if ((node.depth ?? 1) > previousDepth + 1 && previousDepth)
        context.add(
          "heading-increment",
          range.from,
          "A heading skips a level; choose its intended depth manually.",
        );
      previousDepth = node.depth ?? 1;
      around(context, node, "blanks-around-headings");
    }
    if (node.type === "list") {
      listMarkers(context, node);
      if (!parents.some((parent) => parent.type === "list"))
        around(context, node, "blanks-around-lists");
    }
    if (
      node.type === "code" &&
      /^(?:`{3,}|~{3,})/.test(document.source.slice(range.from))
    ) {
      around(context, node, "blanks-around-fences");
      if (!node.lang)
        context.add(
          "fence-language",
          range.from,
          "Choose a language for this code fence.",
        );
    }
  }
  listIndentation(context);
  for (const line of document.lines) {
    if (line.from < document.bodyFrom) continue;
    const malformed = /^( {0,3})(#{1,6})([^#\s])/.exec(line.text);
    if (malformed && !isProtected(document, line.from, line.to))
      context.add(
        "heading-space",
        line.from + malformed[1]!.length,
        "A possible heading has no space. Changing paragraph structure requires a manual edit.",
      );
  }
}
