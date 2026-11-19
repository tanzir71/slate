import {
  analyzeTemplateVariables,
  renderTemplateText,
  type TemplateContext,
  type TemplateVariableIssue,
} from "./templateVariables.js";

export type SnippetNode =
  | { readonly kind: "text"; readonly value: string }
  | {
      readonly kind: "variable";
      readonly source: string;
      readonly from: number;
    }
  | {
      readonly kind: "field";
      readonly index: number;
      readonly children?: readonly SnippetNode[];
      readonly rawDefault?: string;
    };
export interface SnippetTemplate {
  readonly nodes: readonly SnippetNode[];
  readonly defaults: ReadonlyMap<number, readonly SnippetNode[]>;
}
export interface SnippetField {
  readonly index: number;
  readonly from: number;
  readonly to: number;
  readonly order: number;
  readonly parents: readonly number[];
}
const limit = 1_048_576;

/** Parse tab stops before expanding variables, so user values cannot add fields. */
export function parseSnippetTemplate(source: string): SnippetTemplate {
  if (source.length > limit)
    throw new Error("A snippet body must be at most 1 MiB of text.");
  let at = 0,
    count = 0;
  function variable(): SnippetNode {
    const from = at;
    let depth = 0;
    do {
      if (source.startsWith("{{", at)) {
        depth++;
        at += 2;
      } else if (source.startsWith("}}", at)) {
        depth--;
        at += 2;
      } else at++;
    } while (at < source.length && depth > 0);
    return { kind: "variable", source: source.slice(from, at), from };
  }
  function sequence(closing = false, depth = 0): SnippetNode[] {
    if (depth > 32) throw new Error("Snippet tab stops are nested too deeply.");
    const nodes: SnippetNode[] = [];
    let text = "",
      braces = 0;
    const flush = () => {
      if (text) {
        nodes.push({ kind: "text", value: text });
        text = "";
      }
    };
    while (at < source.length) {
      const char = source[at]!;
      if (char === "\\" && /[$\\{}]/.test(source[at + 1] ?? "")) {
        text += source[at + 1];
        at += 2;
        continue;
      }
      if (source.startsWith("{{", at)) {
        flush();
        nodes.push(variable());
        continue;
      }
      if (char === "$" && /[\d{]/.test(source[at + 1] ?? "")) {
        const start = at,
          braced = source[at + 1] === "{";
        let end = at + (braced ? 2 : 1);
        const numberFrom = end;
        while (/\d/.test(source[end] ?? "")) end++;
        if (end === numberFrom) {
          text += char;
          at++;
          continue;
        }
        const index = Number(source.slice(numberFrom, end));
        if (index > 999)
          throw new Error(
            "Use tab-stop numbers from 0 to 999, or escape the dollar sign.",
          );
        if (++count > 1024)
          throw new Error("A snippet has too many tab stops.");
        flush();
        at = end;
        if (!braced) nodes.push({ kind: "field", index });
        else if (source[at] === "}") {
          at++;
          nodes.push({ kind: "field", index });
        } else if (source[at] === ":") {
          const bodyFrom = ++at;
          const children = sequence(true, depth + 1);
          nodes.push({
            kind: "field",
            index,
            children,
            rawDefault: source.slice(bodyFrom, at - 1),
          });
        } else
          throw new Error(
            "Expected : or } after the tab-stop number at " + start + ".",
          );
        continue;
      }
      if (closing && char === "{") braces++;
      if (closing && char === "}") {
        if (braces === 0) {
          at++;
          flush();
          return nodes;
        }
        braces--;
      }
      text += char;
      at++;
    }
    if (closing)
      throw new Error("A snippet tab stop is missing its closing }.");
    flush();
    return nodes;
  }
  const nodes = sequence();
  const defaults = new Map<number, readonly SnippetNode[]>(),
    raw = new Map<number, string>();
  function collect(items: readonly SnippetNode[]) {
    for (const node of items)
      if (node.kind === "field" && node.children) {
        if (raw.has(node.index) && raw.get(node.index) !== node.rawDefault)
          throw new Error(
            "Tab stop " + node.index + " has conflicting defaults.",
          );
        defaults.set(node.index, node.children);
        raw.set(node.index, node.rawDefault!);
        collect(node.children);
      }
  }
  collect(nodes);
  const heights = new Map<number, number>(),
    visiting = new Set<number>();
  function check(index: number): number {
    if (heights.has(index)) return heights.get(index)!;
    if (visiting.has(index))
      throw new Error("A snippet tab stop cannot contain itself.");
    if (visiting.size >= 32)
      throw new Error("Snippet tab stops are nested too deeply.");
    visiting.add(index);
    let height = 1;
    for (const node of defaults.get(index) ?? [])
      if (node.kind === "field")
        height = Math.max(height, 1 + check(node.index));
    visiting.delete(index);
    if (height > 32)
      throw new Error("Snippet tab stops are nested too deeply.");
    heights.set(index, height);
    return height;
  }
  // Validate the definition graph once, before repeated fields can amplify it.
  for (const index of defaults.keys()) check(index);
  return { nodes, defaults };
}

export function analyzeSnippetTemplate(template: SnippetTemplate) {
  const variables: string[] = [];
  function visit(nodes: readonly SnippetNode[]) {
    for (const node of nodes) {
      if (node.kind === "variable") variables.push(node.source);
      else if (node.kind === "field" && node.children) visit(node.children);
    }
  }
  visit(template.nodes);
  return analyzeTemplateVariables(variables.join("\n"));
}

export function renderSnippetTemplate(
  template: SnippetTemplate,
  context: TemplateContext,
): {
  text: string;
  fields: SnippetField[];
  issues: TemplateVariableIssue[];
} {
  const prompts = analyzeSnippetTemplate(template).prompts;
  const pieces: string[] = [],
    fields: SnippetField[] = [],
    issues: TemplateVariableIssue[] = [];
  let length = 0,
    order = 0;
  function nextOrder() {
    if (order >= 1024)
      throw new Error("A snippet expansion has too many tab-stop occurrences.");
    return order++;
  }
  function append(value: string) {
    const text = value.replace(/\r\n?/g, "\n");
    length += text.length;
    if (length > limit)
      throw new Error("A snippet expansion must be at most 1 MiB of text.");
    pieces.push(text);
  }
  function visit(
    nodes: readonly SnippetNode[],
    parents: readonly number[] = [],
  ) {
    for (const node of nodes) {
      if (node.kind === "text") append(node.value);
      else if (node.kind === "variable") {
        const rendered = renderTemplateText(node.source, context, prompts),
          from = length;
        append(rendered.text);
        issues.push(
          ...rendered.issues.map((issue) => ({
            ...issue,
            from: issue.from + node.from,
            to: issue.to + node.from,
          })),
        );
        if (rendered.cursor !== undefined)
          fields.push({
            index: 0,
            from: from + rendered.cursor,
            to: from + rendered.cursor,
            order: nextOrder(),
            parents,
          });
      } else {
        const from = length,
          ordinal = nextOrder();
        const children = template.defaults.get(node.index);
        if (children) visit(children, [...parents, ordinal]);
        fields.push({
          index: node.index,
          from,
          to: length,
          order: ordinal,
          parents,
        });
      }
    }
  }
  visit(template.nodes);
  const final = fields
    .filter((field) => field.index === 0)
    .sort((a, b) => a.from - b.from || a.order - b.order)[0];
  const stops = fields.filter((field) => field.index !== 0);
  stops.push(
    final ?? { index: 0, from: length, to: length, order, parents: [] },
  );
  const unique = new Map(
    issues.map((issue) => [
      JSON.stringify([issue.from, issue.to, issue.kind]),
      issue,
    ]),
  );
  return { text: pieces.join(""), fields: stops, issues: [...unique.values()] };
}
