import {
  isAlias,
  isMap,
  isNode,
  isPair,
  isScalar,
  parseDocument,
  visit,
  type Document,
  type Node,
} from "yaml";
import {
  analyzeTemplateVariables,
  renderTemplateText,
  type TemplateContext,
  type TemplatePrompt,
  type TemplateVariableIssue,
} from "./templateVariables.js";

export interface MarkdownTemplate {
  readonly source: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly destination?: string;
  readonly filename?: string;
}
export interface MarkdownTemplateIssue {
  readonly scope: string;
  readonly issue: TemplateVariableIssue;
}
interface Header {
  document: Document;
  opening: string;
  closing: string;
  eol: string;
  body: string;
  bom: string;
}
function validate(document: Document): void {
  if (document.errors.length)
    throw new Error(
      "Invalid template properties: " + document.errors[0]!.message,
    );
  // Resolve aliases with the library's amplification budget; values remain AST nodes.
  document.toJS({ mapAsMap: true, maxAliasCount: 100 });
}
function header(source: string): Header | undefined {
  const opening = /^(\uFEFF?---[ \t]*)(\r\n|\n|\r)/.exec(source);
  if (!opening) {
    if (/^\uFEFF?---[ \t]*$/.test(source))
      throw new Error("Template properties need a closing --- or ... line.");
    return;
  }
  const tail = source.slice(opening[0].length);
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r\n|\n|\r|$)/m.exec(tail);
  if (!closing)
    throw new Error("Template properties need a closing --- or ... line.");
  const document: Document = parseDocument(tail.slice(0, closing.index), {
    logLevel: "silent",
    uniqueKeys: true,
  });
  validate(document);
  if (document.contents && !isMap(document.contents))
    throw new Error("Template properties must be a YAML mapping.");
  if (!document.contents) document.contents = document.createNode({});
  return {
    document,
    opening: opening[0],
    closing: closing[0],
    eol: opening[2]!,
    body: tail.slice(closing.index + closing[0].length),
    bom: source.startsWith("\uFEFF") ? "\uFEFF" : "",
  };
}
function resolved(node: unknown, document: Document): unknown {
  const seen = new Set<Node>();
  while (isAlias(node)) {
    if (seen.has(node))
      throw new Error("Template configuration cannot contain an alias cycle.");
    seen.add(node);
    node = node.resolve(document);
  }
  return node;
}
function configText(
  config: unknown,
  key: string,
  document: Document,
): string | undefined {
  if (!isMap(config) || !config.has(key)) return;
  const node = resolved(config.get(key, true), document);
  if (!node || (isScalar(node) && node.value === null)) return;
  if (isScalar(node) && typeof node.value === "string") return node.value;
  throw new Error("Template " + key + " must be text.");
}
export function readMarkdownTemplate(
  source: string,
  fallbackName: string,
): MarkdownTemplate {
  const parsed = header(source),
    document = parsed?.document;
  const config = document
    ? resolved(document.get("template", true), document)
    : undefined;
  if (config && !(isScalar(config) && config.value === null) && !isMap(config))
    throw new Error("The template configuration must be a mapping.");
  const field = (name: string) =>
    document ? configText(config, name, document) : undefined;
  const destination = field("destination"),
    filename = field("filename");
  return {
    source,
    name: field("name")?.trim() || fallbackName.trim() || "Untitled template",
    description: field("description") ?? "",
    category: field("category")?.trim() || "Other",
    ...(destination !== undefined ? { destination } : {}),
    ...(filename !== undefined ? { filename } : {}),
  };
}

/** Move referenced configuration anchors to their first sheet use before removing the key. */
function stripConfiguration(document: Document): void {
  const config = document.get("template", true);
  const removed = new Set<Node>();
  if (isNode(config))
    visit(config, {
      Node(_key, node) {
        removed.add(node);
      },
    });
  const targets = new Map<number, Node>();
  visit(document, {
    Alias(_key, alias) {
      const target = alias.resolve(document);
      if (!target)
        throw new Error("Unknown template property alias: " + alias.source);
      if (alias.range) targets.set(alias.range[0], target);
    },
  });
  document.delete("template");
  const promoted = new Set<Node>();
  visit(document, {
    Alias(_key, alias) {
      const target = alias.range ? targets.get(alias.range[0]) : undefined;
      if (!target || !removed.has(target) || promoted.has(target)) return;
      promoted.add(target);
      const copy = target.clone();
      if (!isNode(copy))
        throw new Error("A template alias could not be copied.");
      copy.comment =
        [copy.comment, alias.comment].filter(Boolean).join("\n") || null;
      copy.commentBefore =
        [copy.commentBefore, alias.commentBefore].filter(Boolean).join("\n") ||
        null;
      return copy;
    },
  });
}
function contentSources(template: MarkdownTemplate) {
  const parsed = header(template.source);
  const values: {
    scope: string;
    source: string;
    assign?: (value: string) => void;
  }[] = [];
  if (parsed) {
    stripConfiguration(parsed.document);
    const comments = (
      scope: string,
      owner: { comment?: string | null; commentBefore?: string | null },
    ) => {
      for (const key of ["commentBefore", "comment"] as const) {
        const source = owner[key];
        if (source)
          values.push({
            scope: scope + ".comment",
            source,
            assign: (value) => {
              owner[key] = value;
            },
          });
      }
    };
    comments("frontmatter", parsed.document);
    visit(parsed.document, {
      Node(_key, node, path) {
        const keys = path
          .filter(isPair)
          .map((pair) =>
            isScalar(pair.key) ? String(pair.key.value) : "property",
          );
        const scope = ["frontmatter", ...keys].join(".");
        comments(scope, node);
        if (isScalar(node) && typeof node.value === "string")
          values.push({
            scope,
            source: node.value,
            assign: (value) => {
              node.value = value;
            },
          });
      },
    });
  }
  values.push({ scope: "body", source: parsed?.body ?? template.source });
  if (template.filename !== undefined)
    values.push({ scope: "filename", source: template.filename });
  if (template.destination !== undefined)
    values.push({ scope: "destination", source: template.destination });
  return { parsed, values };
}

/** Preview exactly the sheet source, retaining variable expressions and cursor markers. */
export function previewMarkdownTemplate(template: MarkdownTemplate): string {
  const parsed = header(template.source);
  if (!parsed) return template.source;
  stripConfiguration(parsed.document);
  const contents = parsed.document.contents;
  if (
    isMap(contents) &&
    !contents.items.length &&
    ![parsed.document, contents].some(
      (node) => node.comment || node.commentBefore,
    )
  ) {
    return parsed.bom + parsed.body;
  }
  return (
    parsed.opening +
    parsed.document
      .toString({ lineWidth: 0, directives: false })
      .replace(/\n/g, parsed.eol) +
    parsed.closing +
    parsed.body
  );
}
export function analyzeMarkdownTemplate(template: MarkdownTemplate): {
  prompts: TemplatePrompt[];
  variables: string[];
} {
  const prompts = new Map<string, TemplatePrompt>(),
    variables = new Set<string>();
  for (const field of contentSources(template).values) {
    const found = analyzeTemplateVariables(field.source);
    for (const variable of found.variables) variables.add(variable);
    for (const prompt of found.prompts)
      if (!prompts.has(prompt.label)) prompts.set(prompt.label, prompt);
  }
  return { prompts: [...prompts.values()], variables: [...variables] };
}
function cursorMarker(sources: readonly string[]): string {
  let index = 0,
    marker: string;
  do {
    marker = "\uE000slate-cursor" + index++ + "\uE001";
  } while (sources.some((source) => source.includes(marker)));
  return marker;
}
export function renderMarkdownTemplate(
  template: MarkdownTemplate,
  context: TemplateContext,
): {
  content: string;
  cursor?: number;
  destination: string;
  filename: string;
  issues: MarkdownTemplateIssue[];
} {
  const { parsed, values } = contentSources(template),
    prompts = analyzeMarkdownTemplate(template).prompts;
  const rendered = values.map((field) => ({
    ...field,
    result: renderTemplateText(field.source, context, prompts),
  }));
  const marker = cursorMarker([
      template.source,
      ...rendered.map((field) => field.result.text),
    ]),
    issues: MarkdownTemplateIssue[] = [];
  let marked = false,
    body = parsed?.body ?? template.source,
    bodyCursor: number | undefined;
  let destination = context.notebook ?? "",
    filename = context.title ?? "Untitled";
  for (const field of rendered) {
    const { result } = field;
    issues.push(
      ...result.issues.map((issue) => ({ scope: field.scope, issue })),
    );
    if (field.assign) {
      const value =
        result.cursor !== undefined
          ? result.text.slice(0, result.cursor) +
            marker +
            result.text.slice(result.cursor)
          : result.text;
      if (result.cursor !== undefined) marked = true;
      field.assign(value);
    } else if (field.scope === "body") {
      body = result.text;
      bodyCursor = result.cursor;
    } else if (field.scope === "destination") destination = result.text;
    else if (field.scope === "filename") filename = result.text;
  }
  let prefix = parsed?.bom ?? "";
  if (
    parsed &&
    isMap(parsed.document.contents) &&
    (parsed.document.contents.items.length ||
      [parsed.document, parsed.document.contents].some(
        (node) => node.comment || node.commentBefore,
      ))
  ) {
    const yaml = parsed.document.toString({ lineWidth: 0, directives: false });
    const check = parseDocument(yaml.replaceAll(marker, ""), {
      logLevel: "silent",
      uniqueKeys: true,
    });
    validate(check);
    if (check.has("template"))
      throw new Error(
        "Sheet properties cannot render a reserved template key.",
      );
    prefix = parsed.opening + yaml.replace(/\n/g, parsed.eol) + parsed.closing;
  }
  const markedAt = marked ? prefix.indexOf(marker) : -1;
  if (marked && markedAt < 0)
    throw new Error("The template cursor could not be represented in YAML.");
  if (markedAt >= 0) prefix = prefix.replaceAll(marker, "");
  const cursor =
    markedAt >= 0
      ? markedAt
      : bodyCursor !== undefined
        ? prefix.length + bodyCursor
        : undefined;
  return {
    content: prefix + body,
    ...(cursor !== undefined ? { cursor } : {}),
    destination,
    filename,
    issues,
  };
}
