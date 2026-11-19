import { parseSnippetTemplate } from "./snippetTemplate.js";

export type SnippetActivation = "tab" | "space" | "both";
export interface SnippetDefinition extends Readonly<Record<string, unknown>> {
  readonly trigger: string;
  readonly name: string;
  readonly body: string;
  readonly expandOn: SnippetActivation;
  readonly enabled: boolean;
}
export interface SnippetConfiguration extends Readonly<
  Record<string, unknown>
> {
  readonly version: 1;
  readonly snippets: readonly SnippetDefinition[];
}
export interface ScopedSnippet extends SnippetDefinition {
  readonly origin: "global" | "space";
}

/** Strict reads never silently replace an invalid configuration with a blank one. */
export function readSnippetConfiguration(value: unknown): SnippetConfiguration {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("version" in value) ||
    value.version !== 1 ||
    !("snippets" in value) ||
    !Array.isArray(value.snippets)
  )
    throw new Error(
      "Use snippet configuration version 1 with a snippets array.",
    );
  if (value.snippets.length > 1000)
    throw new Error("A configuration can contain at most 1000 snippets.");
  const triggers = new Set<string>();
  const snippets = value.snippets.map((item: unknown): SnippetDefinition => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("Each snippet must be an object.");
    const source = item as Record<string, unknown>,
      trigger = source.trigger;
    if (
      typeof trigger !== "string" ||
      !trigger ||
      trigger.length > 64 ||
      /\s/u.test(trigger) ||
      [...trigger].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    )
      throw new Error(
        "A snippet trigger needs 1–64 characters without whitespace or controls.",
      );
    if (triggers.has(trigger))
      throw new Error("Duplicate snippet trigger: " + trigger);
    triggers.add(trigger);
    if (typeof source.body !== "string")
      throw new Error("Snippet " + trigger + " needs a text body.");
    if (
      source.name !== undefined &&
      (typeof source.name !== "string" || !source.name.trim())
    )
      throw new Error("Snippet " + trigger + " needs a nonempty name.");
    if (source.enabled !== undefined && typeof source.enabled !== "boolean")
      throw new Error("Snippet " + trigger + " enabled must be true or false.");
    const expandOn = source.expandOn ?? "tab";
    if (expandOn !== "tab" && expandOn !== "space" && expandOn !== "both")
      throw new Error(
        "Snippet " + trigger + " expandOn must be tab, space or both.",
      );
    try {
      parseSnippetTemplate(source.body);
    } catch (cause) {
      throw new Error(
        "Snippet " +
          trigger +
          ": " +
          (cause instanceof Error ? cause.message : String(cause)),
        { cause },
      );
    }
    return {
      ...source,
      trigger,
      body: source.body,
      name: (source.name as string | undefined) ?? trigger,
      expandOn,
      enabled: (source.enabled as boolean | undefined) ?? true,
    };
  });
  return { ...value, version: 1, snippets };
}

/** A disabled Space entry also suppresses a global entry with that trigger. */
export function resolveSnippets(
  global: SnippetConfiguration,
  space: SnippetConfiguration,
): ScopedSnippet[] {
  const merged = new Map<string, ScopedSnippet>();
  for (const [configuration, origin] of [
    [global, "global"],
    [space, "space"],
  ] as const)
    for (const definition of configuration.snippets)
      merged.set(definition.trigger, { ...definition, origin });
  return [...merged.values()].filter((entry) => entry.enabled);
}

export function createSnippetIndex(snippets: readonly ScopedSnippet[]) {
  const suffixes = new Map<string, ScopedSnippet[]>();
  let maxLength = 0;
  for (const snippet of snippets) {
    maxLength = Math.max(maxLength, snippet.trigger.length);
    const suffix = snippet.trigger.slice(-1);
    const group = suffixes.get(suffix) ?? [];
    group.push(snippet);
    suffixes.set(suffix, group);
  }
  for (const group of suffixes.values())
    group.sort((a, b) => b.trigger.length - a.trigger.length);
  return { suffixes, maxLength };
}
export type SnippetIndex = ReturnType<typeof createSnippetIndex>;

/** The caller supplies only a bounded suffix; no document scan belongs on Space. */
export function matchSnippet(
  index: SnippetIndex,
  before: string,
  activation: "tab" | "space",
): ScopedSnippet | undefined {
  const candidates = index.suffixes.get(before.slice(-1));
  if (!candidates) return;
  for (const entry of candidates) {
    if (!before.endsWith(entry.trigger)) continue;
    // Do not reinterpret a longer typed trigger as a shorter suffix.
    if (entry.expandOn !== "both" && entry.expandOn !== activation) return;
    const prefix = before.slice(0, -entry.trigger.length),
      previous = /.$/su.exec(prefix)?.[0];
    if (
      !previous ||
      (previous !== "\\" && !/[\p{L}\p{M}\p{N}_]/u.test(previous))
    )
      return entry;
    return;
  }
}
