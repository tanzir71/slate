import type { BlockDefinition, CustomBlock, ScopedSnippet } from "@slate/core";
import type { TemplateCatalogItem } from "../templates/builtinTemplates";

export interface TemplateMenuEntry {
  readonly kind: "template";
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly group: "Templates";
  readonly item: TemplateCatalogItem;
}
export interface SnippetMenuEntry {
  readonly kind: "snippet";
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly group: "Snippets";
  readonly trigger: string;
  readonly definition: ScopedSnippet;
}
export function templateMenuEntry(
  item: TemplateCatalogItem,
): TemplateMenuEntry {
  return {
    kind: "template",
    id: "template:" + item.id,
    label: item.template.name,
    description:
      item.template.description ||
      (item.origin === "space"
        ? (item.path ?? "This Space")
        : "Built-in template"),
    aliases: [
      item.template.category,
      ...(item.path
        ? [item.path.replace(/^\.slate\/templates\//, "").replace(/\.md$/i, "")]
        : []),
    ],
    group: "Templates",
    item,
  };
}
export function snippetMenuEntry(definition: ScopedSnippet): SnippetMenuEntry {
  return {
    kind: "snippet",
    id: `snippet:${definition.origin}:${definition.trigger}`,
    label: definition.name || definition.trigger,
    description:
      typeof definition.description === "string"
        ? definition.description
        : definition.body.replace(/\r\n?|\n/g, " ↵ ").slice(0, 120),
    aliases: [definition.trigger],
    group: "Snippets",
    trigger: definition.trigger,
    definition,
  };
}

export type CreationMenuEntry =
  BlockDefinition | CustomBlock | TemplateMenuEntry | SnippetMenuEntry;

/** IDs may contain user filenames or triggers; keep ARIA IDREFs whitespace-free and injective. */
export function blockMenuOptionId(listId: string, id: string): string {
  return `${listId}-${id.replace(/[^A-Za-z0-9-]/g, (character) => `_${character.charCodeAt(0).toString(16)}_`)}`;
}
