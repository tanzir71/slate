import { applyTextChanges, type TextChange } from "../textChanges.js";
import {
  readTidyConfiguration,
  writeTidyConfiguration,
  tidyRuleIds,
  type TidyPreset,
  type TidyRuleId,
} from "./configuration.js";

export interface TidyConfigurationPatch {
  readonly preset?: TidyPreset;
  readonly keepHardBreaks?: boolean;
  readonly onSave?: boolean;
  readonly rules?: Readonly<Partial<Record<TidyRuleId, boolean>>>;
}
interface Property {
  readonly key: string;
  readonly keyFrom: number;
  readonly from: number;
  readonly to: number;
}
interface ObjectSpan {
  readonly from: number;
  readonly properties: readonly Property[];
}
function whitespace(source: string, from: number): number {
  while (/[ \t\r\n]/.test(source[from] ?? "!")) from++;
  return from;
}
function stringEnd(source: string, from: number): number {
  for (let i = from + 1; i < source.length; i++) {
    if (source[i] === "\\") i++;
    else if (source[i] === '"') return i + 1;
  }
  throw new Error("Cannot locate a Tidy setting.");
}
function valueEnd(source: string, from: number): number {
  if (source[from] === '"') return stringEnd(source, from);
  if (source[from] !== "{" && source[from] !== "[") {
    let to = from;
    while (to < source.length && !/[ \t\r\n,}\]]/.test(source[to]!)) to++;
    return to;
  }
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    if (source[i] === '"') i = stringEnd(source, i) - 1;
    else if (source[i] === "{" || source[i] === "[") depth++;
    else if ((source[i] === "}" || source[i] === "]") && --depth === 0)
      return i + 1;
  }
  throw new Error("Cannot locate a Tidy setting.");
}
/** Syntax is validated first; this scan only locates original JSON tokens. */
function objectSpan(source: string, from: number): ObjectSpan {
  const properties: Property[] = [];
  let cursor = whitespace(source, from + 1);
  while (source[cursor] !== "}") {
    const keyFrom = cursor,
      keyTo = stringEnd(source, cursor);
    const key = JSON.parse(source.slice(keyFrom, keyTo)) as string;
    const valueFrom = whitespace(source, whitespace(source, keyTo) + 1);
    const to = valueEnd(source, valueFrom);
    properties.push({ key, keyFrom, from: valueFrom, to });
    cursor = whitespace(source, to);
    if (source[cursor] !== ",") break;
    cursor = whitespace(source, cursor + 1);
  }
  return { from, properties };
}
function property(object: ObjectSpan, key: string): Property | undefined {
  let found: Property | undefined;
  for (const item of object.properties) if (item.key === key) found = item;
  return found;
}
function patchObject(
  source: string,
  object: ObjectSpan,
  values: Readonly<Record<string, unknown>>,
  changes: TextChange[],
) {
  const missing: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const text = JSON.stringify(value);
    if (text === undefined)
      throw new Error("A Tidy setting must have a JSON value.");
    const current = property(object, key);
    if (!current) missing.push(`${JSON.stringify(key)}: ${text}`);
    else if (source.slice(current.from, current.to) !== text)
      changes.push({ from: current.from, to: current.to, text });
  }
  if (!missing.length) return;
  const last = object.properties.at(-1);
  const end = last?.to ?? object.from + 1;
  const multiline = /[\r\n]/.test(
    source.slice(object.from, valueEnd(source, object.from)),
  );
  const eol = source.match(/\r\n|\n|\r/)?.[0] ?? "\n";
  const beforeKey = last
    ? source.slice(
        Math.max(
          source.lastIndexOf("\n", last.keyFrom),
          source.lastIndexOf("\r", last.keyFrom),
        ) + 1,
        last.keyFrom,
      )
    : "  ";
  const indent = /^[ \t]*$/.test(beforeKey) ? beforeKey : "  ";
  const separator = multiline ? eol + indent : " ";
  const text = `${last ? "," + separator : multiline ? separator : ""}${missing.join("," + separator)}`;
  changes.push({ from: end, to: end, text });
}

/** Change only requested known tokens; unknown JSON and numeric spelling stay literal. */
export function editTidyConfiguration(
  source: string | undefined,
  patch: TidyConfigurationPatch,
): string {
  const original = source ?? writeTidyConfiguration(readTidyConfiguration());
  readTidyConfiguration(original.replace(/^\uFEFF/, ""));
  if (
    Object.keys(patch).some(
      (key) => !["preset", "keepHardBreaks", "onSave", "rules"].includes(key),
    )
  )
    throw new Error("Unknown Tidy configuration change.");
  const root = objectSpan(
    original,
    whitespace(original, original.startsWith("\uFEFF") ? 1 : 0),
  );
  const values: Record<string, unknown> = {};
  for (const key of ["preset", "keepHardBreaks", "onSave"] as const)
    if (Object.hasOwn(patch, key)) values[key] = patch[key];
  const changes: TextChange[] = [];
  if (patch.rules !== undefined) {
    if (
      patch.rules === null ||
      typeof patch.rules !== "object" ||
      Array.isArray(patch.rules)
    )
      throw new Error("Invalid Tidy rule changes.");
    for (const [key, value] of Object.entries(patch.rules))
      if (
        !tidyRuleIds.includes(key as TidyRuleId) ||
        typeof value !== "boolean"
      )
        throw new Error("Invalid Tidy rule changes.");
    const rules = property(root, "rules");
    if (rules)
      patchObject(
        original,
        objectSpan(original, rules.from),
        patch.rules,
        changes,
      );
    else if (Object.keys(patch.rules).length) values.rules = patch.rules;
  }
  patchObject(original, root, values, changes);
  const result = applyTextChanges(
    original,
    changes.sort((a, b) => a.from - b.from || a.to - b.to),
  );
  readTidyConfiguration(result.replace(/^\uFEFF/, ""));
  return result;
}
