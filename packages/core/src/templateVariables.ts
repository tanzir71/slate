import { formatTemplateClock, type TemplateClock } from "./templateClock.js";
export type { TemplateClock } from "./templateClock.js";

export interface TemplateContext {
  readonly title?: string;
  readonly clock?: TemplateClock;
  readonly id?: string;
  readonly space?: string;
  readonly notebook?: string;
  readonly selection?: string;
  readonly clipboard?: string;
  readonly prompts?: Readonly<Record<string, string>>;
}
export interface TemplatePrompt {
  readonly label: string;
  readonly defaultValue?: string;
}
export interface TemplateVariableIssue {
  readonly kind:
    | "unknown-variable"
    | "invalid-variable"
    | "unknown-filter"
    | "missing-value"
    | "invalid-clock";
  readonly variable: string;
  readonly raw: string;
  readonly from: number;
  readonly to: number;
}
interface Token {
  from: number;
  to: number;
  raw: string;
  variable: string;
  argument: string | undefined;
  filters: string[];
  defaultValue: string | undefined;
  malformed: boolean;
}
const variables = new Set([
  "title",
  "date",
  "time",
  "cursor",
  "selection",
  "clipboard",
  "prompt",
  "space",
  "notebook",
  "id",
]);
const filters = new Set(["slug", "upper", "lower"]);
function pipes(value: string): string[] {
  const parts: string[] = [""];
  for (let at = 0; at < value.length; at++) {
    const char = value[at]!;
    if (char === "\\" && (value[at + 1] === "|" || value[at + 1] === "\\"))
      parts[parts.length - 1] += value[++at]!;
    else if (char === "|") parts.push("");
    else parts[parts.length - 1] += char;
  }
  return parts;
}
function tokens(source: string): Token[] {
  const ranges: { from: number; to: number; malformed: boolean }[] = [];
  let from = 0,
    depth = 0,
    nested = false;
  for (const marker of source.matchAll(/\{\{|\}\}/g)) {
    if (marker[0] === "{{") {
      if (depth === 0) {
        from = marker.index;
        nested = false;
      } else nested = true;
      depth++;
    } else if (depth > 0 && --depth === 0) {
      ranges.push({ from, to: marker.index + 2, malformed: nested });
    }
  }
  if (depth > 0) ranges.push({ from, to: source.length, malformed: true });
  return ranges.map((range) => {
    const raw = source.slice(range.from, range.to);
    const parts = pipes(raw.slice(2, -2)),
      head = parts.shift()!.trim(),
      colon = head.indexOf(":");
    const variable = colon < 0 ? head : head.slice(0, colon).trim();
    return {
      ...range,
      raw,
      variable,
      argument: colon < 0 ? undefined : head.slice(colon + 1).trim(),
      defaultValue: variable === "prompt" ? parts.shift() : undefined,
      filters: parts.map((part) => part.trim()),
    };
  });
}
function invalid(token: Token): TemplateVariableIssue["kind"] | undefined {
  if (token.malformed) return "invalid-variable";
  if (!variables.has(token.variable)) return "unknown-variable";
  if (
    token.variable === "prompt"
      ? !token.argument
      : token.argument !== undefined &&
        token.variable !== "date" &&
        token.variable !== "time"
  )
    return "invalid-variable";
  if (token.filters.some((filter) => !filters.has(filter)))
    return "unknown-filter";
}
function promptsIn(items: readonly Token[]): TemplatePrompt[] {
  const prompts = new Map<string, TemplatePrompt>();
  for (const token of items) {
    if (
      token.variable !== "prompt" ||
      invalid(token) ||
      prompts.has(token.argument!)
    )
      continue;
    prompts.set(token.argument!, {
      label: token.argument!,
      ...(token.defaultValue !== undefined
        ? { defaultValue: token.defaultValue }
        : {}),
    });
  }
  return [...prompts.values()];
}
export function analyzeTemplateVariables(source: string) {
  const items = tokens(source);
  return {
    prompts: promptsIn(items),
    variables: [...new Set(items.map((token) => token.variable))],
  };
}
export function templateSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}
function filtered(value: string, names: readonly string[]): string {
  for (const name of names)
    value =
      name === "slug"
        ? templateSlug(value)
        : name === "upper"
          ? value.toUpperCase()
          : value.toLowerCase();
  return value;
}
function valueOf(
  token: Token,
  context: TemplateContext,
  prompts: ReadonlyMap<string, TemplatePrompt>,
): string | undefined {
  switch (token.variable) {
    case "cursor":
      return "";
    case "selection":
      return context.selection ?? "";
    case "date":
    case "time":
      return context.clock
        ? formatTemplateClock(
            context.clock,
            token.argument ??
              (token.variable === "date" ? "YYYY-MM-DD" : "HH:mm"),
          )
        : undefined;
    case "prompt":
      return context.prompts && Object.hasOwn(context.prompts, token.argument!)
        ? context.prompts[token.argument!]
        : prompts.get(token.argument!)?.defaultValue;
    case "title":
    case "space":
    case "notebook":
    case "id":
    case "clipboard":
      return context[token.variable];
    default:
      return undefined;
  }
}
/** One non-recursive pass over tokens; user values are literal data, never code. */
export function renderTemplateText(
  source: string,
  context: TemplateContext,
  promptDefinitions?: readonly TemplatePrompt[],
): {
  text: string;
  cursor?: number;
  issues: TemplateVariableIssue[];
} {
  const items = tokens(source),
    prompts = new Map(
      (promptDefinitions ?? promptsIn(items)).map((prompt) => [
        prompt.label,
        prompt,
      ]),
    );
  const pieces: string[] = [],
    issues: TemplateVariableIssue[] = [];
  let previous = 0,
    length = 0,
    cursor: number | undefined;
  for (const token of items) {
    const literal = source.slice(previous, token.from);
    pieces.push(literal);
    length += literal.length;
    const value = valueOf(token, context, prompts);
    const problem =
      invalid(token) ??
      (value === undefined
        ? (token.variable === "date" || token.variable === "time") &&
          context.clock
          ? "invalid-clock"
          : "missing-value"
        : undefined);
    const replacement = problem ? token.raw : filtered(value!, token.filters);
    if (problem)
      issues.push({
        kind: problem,
        variable: token.variable,
        raw: token.raw,
        from: token.from,
        to: token.to,
      });
    else if (token.variable === "cursor" && cursor === undefined)
      cursor = length;
    pieces.push(replacement);
    length += replacement.length;
    previous = token.to;
  }
  pieces.push(source.slice(previous));
  return {
    text: pieces.join(""),
    ...(cursor !== undefined ? { cursor } : {}),
    issues,
  };
}
