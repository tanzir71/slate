export const tidyRuleIds = [
  "heading-space",
  "heading-start-left",
  "blanks-around-headings",
  "heading-increment",
  "list-marker",
  "list-indent",
  "ol-prefix",
  "list-marker-space",
  "blanks-around-lists",
  "blanks-around-fences",
  "fence-language",
  "emphasis-style",
  "strong-style",
  "no-space-in-emphasis",
  "trailing-space",
  "no-hard-tabs",
  "multiple-blanks",
  "final-newline",
  "table-pipes",
  "table-columns",
  "table-align",
  "yaml-style",
  "bare-urls",
] as const;
export type TidyRuleId = (typeof tidyRuleIds)[number];
export type TidyPreset = "slate" | "github" | "minimal";
export interface TidyConfiguration {
  readonly [key: string]: unknown;
  readonly version: 1;
  readonly preset: TidyPreset;
  readonly rules: Readonly<Record<string, unknown>>;
  readonly keepHardBreaks: boolean;
  readonly onSave: boolean;
}
const minimal = new Set<TidyRuleId>([
  "heading-increment",
  "fence-language",
  "table-columns",
  "trailing-space",
  "no-hard-tabs",
  "multiple-blanks",
  "final-newline",
]);
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function configuration(value: unknown): TidyConfiguration {
  if (!object(value))
    throw new Error("Tidy configuration must be a JSON object.");
  if (value.version !== 1)
    throw new Error("Unsupported Tidy configuration version.");
  const preset = Object.hasOwn(value, "preset") ? value.preset : "slate";
  if (preset !== "slate" && preset !== "github" && preset !== "minimal")
    throw new Error("Unknown Tidy preset.");
  const rules = Object.hasOwn(value, "rules") ? value.rules : {};
  if (!object(rules)) throw new Error("Tidy rules must be a JSON object.");
  for (const id of tidyRuleIds) {
    if (Object.hasOwn(rules, id) && typeof rules[id] !== "boolean")
      throw new Error(`Tidy rule ${id} must be enabled or disabled.`);
  }
  for (const key of ["keepHardBreaks", "onSave"] as const) {
    if (Object.hasOwn(value, key) && typeof value[key] !== "boolean")
      throw new Error(`Tidy ${key} must be a boolean.`);
  }
  return {
    ...value,
    version: 1,
    preset,
    rules: { ...rules },
    keepHardBreaks: value.keepHardBreaks !== false,
    onSave: value.onSave === true,
  };
}
export function readTidyConfiguration(source?: string): TidyConfiguration {
  return configuration(
    source === undefined ? { version: 1 } : (JSON.parse(source) as unknown),
  );
}
export function writeTidyConfiguration(value: TidyConfiguration): string {
  return JSON.stringify(configuration(value), null, 2) + "\n";
}
export function enabledTidyRules(
  config: TidyConfiguration,
): ReadonlySet<TidyRuleId> {
  return new Set(
    tidyRuleIds.filter((id) => {
      const override = config.rules[id];
      if (typeof override === "boolean") return override;
      if (config.preset === "minimal") return minimal.has(id);
      if (id === "bare-urls") return false;
      if (
        config.preset === "github" &&
        (id === "yaml-style" || id === "table-align")
      )
        return false;
      return true;
    }),
  );
}
