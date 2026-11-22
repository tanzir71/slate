import type { ImportMarkup } from "./markup";

export const noteImportSources = [
  { id: "bear", name: "Bear", formats: "Markdown, TextBundle folders, or TextPack/ZIP exports" },
  { id: "notion", name: "Notion", formats: "Markdown & CSV or HTML ZIP exports, including subpages and attachments" },
  { id: "ulysses", name: "Ulysses", formats: "Markdown, TextBundle folders, or TextPack/ZIP exports" },
  { id: "evernote", name: "Evernote", formats: "ENEX exports with embedded resources" },
  { id: "apple-notes", name: "Apple Notes", formats: "HTML files with their attachment folders, or a ZIP containing them" },
] as const;
export type NoteImportSource = (typeof noteImportSources)[number]["id"];
export interface NoteImportInput { readonly path: string; readonly file: Pick<Blob, "size" | "arrayBuffer"> }
export interface NoteImportPlan {
  readonly source: NoteImportSource;
  readonly label: string;
  readonly entries: Readonly<Record<string, Uint8Array>>;
  readonly notes: readonly string[];
  readonly warnings: readonly string[];
}
interface DraftPath { readonly source: string; readonly target: string }
export type NoteImportDraft =
  | DraftPath & { readonly kind: "raw"; readonly bytes: Uint8Array }
  | DraftPath & { readonly kind: "markdown" | "text" | "csv"; readonly text: string }
  | DraftPath & { readonly kind: "markup"; readonly markup: ImportMarkup; readonly prefix: string; readonly media?: ReadonlyMap<string, string> };
