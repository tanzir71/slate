import { validateImportSourcePath } from "@slate/core";
import { readBrowserArchive } from "./browserArchive";
import { planNoteImport } from "./noteImport/planner";
import type { NoteImportInput, NoteImportSource } from "./noteImport/types";
export { noteImportSources } from "./noteImport/types";
export type { NoteImportInput, NoteImportPlan, NoteImportSource } from "./noteImport/types";
export { planNoteImport } from "./noteImport/planner";

/** Read only the files explicitly selected by the user; no network or filesystem authority is added. */
export async function readNoteImport(source: NoteImportSource, inputs: readonly NoteImportInput[]) {
  const entries = Object.create(null) as Record<string, Uint8Array>;
  let total = 0;
  const add = (path: string, bytes: Uint8Array) => {
    const safe = validateImportSourcePath(path);
    if (Object.hasOwn(entries, safe)) throw Error(`Duplicate paths in the selected exports: ${safe}. Import them separately.`);
    if (bytes.length > 100 * 1024 * 1024) throw Error("An imported file exceeds 100 MB.");
    total += bytes.length; if (total > 500 * 1024 * 1024) throw Error("The selected export exceeds 500 MB.");
    entries[safe] = bytes;
  };
  for (const input of inputs) {
    const path = validateImportSourcePath(input.path);
    if (input.file.size > 100 * 1024 * 1024) throw Error("An imported file exceeds 100 MB.");
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    if (!path.includes("/") && /\.(?:zip|textpack)$/i.test(path)) {
      const files = await readBrowserArchive(bytes, validateImportSourcePath);
      const textpack = /\.textpack$/i.test(path), prefix = textpack ? path.replace(/\.textpack$/i, ".textbundle/") : "";
      for (const [name, data] of Object.entries(files)) add(prefix + name, data);
    } else add(path, bytes);
  }
  return planNoteImport(source, entries);
}
