import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import {
  formatMarkdownTable,
  parseMarkdownTable,
  parseMarkdownTableLine,
} from "../markdownTable.js";
import {
  nodeLines,
  replaceIfDifferent,
  type RuleContext,
} from "./ruleContext.js";
import { nodeRange } from "./source.js";

function tables(context: RuleContext) {
  const { document } = context;
  for (const { node } of document.visits) {
    if (node.type !== "table") continue;
    const range = nodeRange(document, node);
    if (!range || !node.position) continue;
    const physical = nodeLines(document, node);
    const lines = physical.map((line, index) => {
      const row = node.children?.[index === 0 ? 0 : index - 1];
      const rowRange = row ? nodeRange(document, row) : undefined;
      const offset =
        index === 1
          ? /^[ \t>]*/.exec(line.text)![0].length
          : rowRange
            ? rowRange.from - line.from
            : node.position!.start.column - 1;
      return {
        prefix: line.text.slice(0, offset),
        text: line.text.slice(offset),
      };
    });
    const parsed = parseMarkdownTable(lines);
    if (!parsed) continue;
    const count = parsed.table.header.cells.length;
    if (parsed.table.body.some((row) => row.cells.length !== count)) {
      context.add(
        "table-columns",
        range.from,
        "This table has mismatched columns; retain every cell and repair it manually.",
      );
      continue;
    }
    const withPipes = lines
      .map((line) => {
        const row = parseMarkdownTableLine(line.text)!;
        const first = row.pipes[0],
          last = row.pipes.at(-1);
        const leading =
          first !== undefined && /^[ \t]*$/.test(line.text.slice(0, first));
        const trailing =
          last !== undefined && /^[ \t]*$/.test(line.text.slice(last + 1));
        return (
          line.prefix +
          (leading ? "" : "| ") +
          line.text +
          (trailing ? "" : " |")
        );
      })
      .join(document.eol);
    const from = physical[0]!.from,
      to = physical.at(-1)!.to;
    replaceIfDifferent(
      context,
      "table-pipes",
      from,
      to,
      withPipes,
      "Use leading and trailing table pipes.",
    );
    const formatted = formatMarkdownTable(parsed.table);
    if (formatted)
      replaceIfDifferent(
        context,
        "table-align",
        from,
        to,
        formatted.source.replace(/\n/g, document.eol),
        "Pad table cells and retain their alignment.",
      );
  }
}

function flowSequences(value: unknown) {
  if (isSeq(value)) {
    value.flow = true;
    for (const child of value.items) flowSequences(child);
  }
  if (isMap(value))
    for (const pair of value.items) {
      flowSequences(pair.key);
      flowSequences(pair.value);
    }
}
function yaml(context: RuleContext) {
  const { document } = context;
  if (!context.enabled.has("yaml-style") || !document.bodyFrom) return;
  const prefix = document.source.slice(0, document.bodyFrom),
    opening = /^\uFEFF?---[ \t]*(?:\r\n|\n|\r)/.exec(prefix);
  if (!opening) return;
  const remainder = prefix.slice(opening[0].length),
    closing = /^(?:---|\.\.\.)[ \t]*(?:\r\n|\n|\r|$)/m.exec(remainder);
  if (!closing || closing.index + closing[0].length !== remainder.length)
    return;
  const from = opening[0].length,
    to = from + closing.index,
    raw = document.source.slice(from, to);
  const value = parseDocument(raw.replace(/\r\n?|\n/g, "\n"), {
    intAsBigInt: true,
  });
  if (value.errors.length || value.warnings.length) {
    context.add(
      "yaml-style",
      from,
      "Front matter is invalid or uses an unsupported tag; preserve it and repair manually.",
    );
    return;
  }
  if (!isMap(value.contents)) return;
  const rank = (key: unknown) =>
    isScalar(key) ? ["title", "date", "tags"].indexOf(String(key.value)) : -1;
  value.contents.items.sort((a, b) => {
    const left = rank(a.key),
      right = rank(b.key);
    return (left < 0 ? 3 : left) - (right < 0 ? 3 : right);
  });
  flowSequences(value.contents);
  const text = value
    .toString({ lineWidth: 0, flowCollectionPadding: false })
    .replace(/\n/g, document.eol);
  replaceIfDifferent(
    context,
    "yaml-style",
    from,
    to,
    text,
    "Use consistent YAML spacing, flow arrays, and title/date/tags order.",
  );
}
export function tableYamlRules(context: RuleContext) {
  tables(context);
  yaml(context);
}
