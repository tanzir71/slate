import { planMarkdownMentionLinks, scanMarkdownMentionText, type MarkdownMentionDocument } from "@slate/core";
import type { MentionReply, MentionRequest, MentionRow } from "./inspectorMentionProtocol";

/** Worker-owned semantic cache. Own-sheet typing changes no other file's scan or results. */
export function createInspectorMentionIndex(scan = scanMarkdownMentionText) {
  const files = new Map<string, { source: string; document?: MarkdownMentionDocument }>(), matches = new Set<string>();
  let targetKey: string | undefined;
  return ({ id, target, changed, removed }: MentionRequest): MentionReply => {
    const key = target ? JSON.stringify([target.id, target.path, target.title]) : "";
    const reset = key !== targetKey; targetKey = key;
    if (reset) matches.clear();
    const affected = new Set<string>(), deleted = new Set<string>();
    function remove(path: string) { files.delete(path); if (matches.delete(path)) deleted.add(path); }
    for (const path of removed) remove(path);
    for (const input of changed) {
      if (input.unsupportedEncoding) { remove(input.path); continue; }
      if (files.get(input.path)?.source === input.content) continue;
      files.set(input.path, { source: input.content }); affected.add(input.path);
    }
    const rows: MentionRow[] = [];
    if (target) {
      const reference = { id: target.id, path: target.path, title: target.title };
      if (!planMarkdownMentionLinks({ source: "", ranges: [] }, reference)) throw Error("This sheet's title cannot be linked without changing its text.");
      for (const path of reset ? files.keys() : affected) {
        const file = files.get(path)!;
        if (path === target.path) { if (matches.delete(path)) deleted.add(path); continue; }
        file.document ??= scan(file.source);
        const plan = planMarkdownMentionLinks(file.document, reference)!;
        if (plan.changes.length) { matches.add(path); rows.push({ path, plan }); }
        else if (matches.delete(path)) deleted.add(path);
      }
    }
    return { id, reset, changed: rows, removed: [...deleted] };
  };
}
