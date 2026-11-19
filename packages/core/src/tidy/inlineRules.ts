import { replaceIfDifferent, type RuleContext } from "./ruleContext.js";
import { isProtected, nodeRange } from "./source.js";

export function inlineRules(context: RuleContext) {
  const { document } = context;
  for (const { node } of document.visits) {
    const range = nodeRange(document, node);
    if (!range) continue;
    const raw = document.source.slice(range.from, range.to);
    if (node.type === "emphasis" || node.type === "strong") {
      const count = node.type === "strong" ? 2 : 1,
        marker = "_".repeat(count),
        rule = node.type === "strong" ? "strong-style" : "emphasis-style";
      if (
        raw.startsWith(marker) &&
        raw.endsWith(marker) &&
        !isProtected(document, range.from, range.from + count) &&
        !isProtected(document, range.to - count, range.to)
      )
        context.add(rule, range.from, "Use consistent emphasis markers.", [
          { from: range.from, to: range.from + count, text: "*".repeat(count) },
          { from: range.to - count, to: range.to, text: "*".repeat(count) },
        ]);
    }
    if (node.type === "link" && !raw.startsWith("[") && !raw.startsWith("<"))
      replaceIfDifferent(
        context,
        "bare-urls",
        range.from,
        range.to,
        `<${raw}>`,
        "Enclose a bare URL in angle brackets.",
      );
  }
  if (!context.enabled.has("no-space-in-emphasis")) return;
  for (const line of document.lines) {
    if (line.from < document.bodyFrom) continue;
    for (const match of line.text.matchAll(
      /(^|[^\\])([*_]{1,2})([ \t]+[^*_\r\n]*?|[^*_\r\n]*?[ \t]+)\2/g,
    )) {
      const from = line.from + match.index + match[1]!.length;
      if (
        !match[3]!.trim() ||
        isProtected(document, from, from + match[0].length - match[1]!.length)
      )
        continue;
      context.add(
        "no-space-in-emphasis",
        from,
        "Possible emphasis contains edge spaces. Repair its intended structure manually.",
      );
    }
  }
}
