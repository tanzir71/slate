import { builtinBlocks, createPaletteIndex, type CommandDefinition, type PaletteEntry, type ScopedSnippet, type SheetDocument } from "@slate/core";
import type { FileSheet } from "@slate/storage/file-space";
import type { CustomBlock } from "@slate/core";
import type { TemplateMenuEntry } from "../blocks/menuCatalog";
import { snippetMenuEntry } from "../blocks/menuCatalog";

export type WorkspacePaletteAction =
  | { kind: "commands"; command: CommandDefinition }
  | { kind: "sheets"; path: string }
  | { kind: "headings"; path: string; source: string; position: number }
  | { kind: "tags"; tag: string }
  | { kind: "blocks"; id: string; source?: string }
  | { kind: "snippets"; definition: ScopedSnippet };
export const paletteIdentity = (entry: Pick<PaletteEntry, "kind" | "id">) => `${entry.kind}/${entry.id}`;

/** Build between inputs from cached metadata; opening or querying never reparses notes. */
export function workspacePalette(input: {
  commands: readonly CommandDefinition[];
  files: readonly Pick<FileSheet, "path" | "unsupportedEncoding">[];
  documents: readonly SheetDocument[];
  blocks: readonly CustomBlock[];
  templates: readonly TemplateMenuEntry[];
  snippets: readonly ScopedSnippet[];
}) {
  const entries: PaletteEntry[] = [], actions = new Map<string, WorkspacePaletteAction>();
  const documents = new Map(input.documents.map((document) => [document.path, document]));
  function add(entry: PaletteEntry, action: WorkspacePaletteAction) {
    entries.push(entry); actions.set(paletteIdentity(entry), action);
  }
  for (const command of input.commands)
    if (command.id !== "app.palette" && command.id !== "app.quickOpen")
      add({ kind: "commands", id: command.id, label: command.label, detail: command.group }, { kind: "commands", command });
  const tags = new Set<string>();
  for (const file of input.files) {
    const document = documents.get(file.path);
    const label = document?.title ?? file.path.split("/").at(-1)?.replace(/\.md$/i, "") ?? file.path;
    add({ kind: "sheets", id: file.path, label, detail: file.path }, { kind: "sheets", path: file.path });
    if (!document || file.unsupportedEncoding) continue;
    for (const tag of document.tags) tags.add(tag.path);
    for (const heading of document.headings ?? [])
      add({ kind: "headings", id: JSON.stringify([file.path, heading.from]), label: heading.label, detail: `${file.path} · line ${heading.line}`, aliases: [label] },
        { kind: "headings", path: file.path, source: document.raw, position: heading.from });
  }
  for (const tag of [...tags].sort()) add({ kind: "tags", id: tag, label: `#${tag}`, detail: "Filter sheets by tag" }, { kind: "tags", tag });
  for (const block of [...builtinBlocks, ...input.blocks, ...input.templates]) {
    const source = "source" in block ? block.source : "kind" in block ? block.item.template.source : undefined;
    add({ kind: "blocks", id: block.id, label: block.label, detail: `${block.description} · insert after the current block`, aliases: block.aliases }, { kind: "blocks", id: block.id, ...(source !== undefined ? { source } : {}) });
  }
  for (const definition of input.snippets) {
    const entry = snippetMenuEntry(definition);
    add({ kind: "snippets", id: entry.id, label: entry.label, detail: `${definition.trigger} · ${definition.origin}`, aliases: entry.aliases }, { kind: "snippets", definition });
  }
  return { entries, actions, index: createPaletteIndex(entries), documents };
}
export type WorkspacePalette = ReturnType<typeof workspacePalette>;
