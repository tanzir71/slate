import { readSnippetConfiguration, type SnippetActivation } from "@slate/core";
import type { SnippetFile } from "@slate/storage/browser-space";
import { builtinSnippets, type SnippetScope } from "./snippetLibrary";

export interface SnippetDraft {
  scope: SnippetScope;
  name: string;
  trigger: string;
  body: string;
  expandOn: SnippetActivation;
  enabled: boolean;
  originalTrigger?: string;
}
export function snippetFileSource(
  file: SnippetFile,
  scope: SnippetScope,
): string {
  if (file.source !== undefined) return file.source;
  if (file.status !== "missing") return "";
  return (
    JSON.stringify(
      scope === "global" ? builtinSnippets : { version: 1, snippets: [] },
      null,
      2,
    ) + "\n"
  );
}
/** Form edits preserve unknown fields on the file and on the edited definition. */
export function editSnippetSource(
  file: SnippetFile,
  draft: SnippetDraft,
): string {
  if (file.status !== "valid" && file.status !== "missing")
    throw new Error("Repair this configuration in the JSON editor first.");
  const raw: Record<string, unknown> = JSON.parse(
    snippetFileSource(file, draft.scope),
  );
  readSnippetConfiguration(raw);
  const entries = raw.snippets as Record<string, unknown>[];
  const index =
    draft.originalTrigger === undefined
      ? -1
      : entries.findIndex((entry) => entry.trigger === draft.originalTrigger);
  if (
    entries.some((entry, at) => at !== index && entry.trigger === draft.trigger)
  )
    throw new Error(
      "That trigger already exists in this scope. Edit its definition instead.",
    );
  const entry = {
    ...(index < 0 ? {} : entries[index]),
    name: draft.name.trim() || draft.trigger,
    trigger: draft.trigger,
    body: draft.body,
    expandOn: draft.expandOn,
    enabled: draft.enabled,
  };
  const snippets = [...entries];
  if (index < 0) snippets.push(entry);
  else snippets[index] = entry;
  const next = { ...raw, snippets };
  readSnippetConfiguration(next);
  return JSON.stringify(next, null, 2) + "\n";
}
