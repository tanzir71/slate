import { parseSheet, type SheetDocument } from "@slate/core";
import type { SheetIndexEntry } from "./index";
import type { SqliteIndexRow } from "./sqliteIndexOperations";

export interface RuntimeMarkdownFileSource {
  listMarkdownFiles(): Promise<string[]>;
  readMarkdownFile(path: string): Promise<string>;
}

export interface RuntimeSqliteIndex {
  readIndex(): Promise<SheetIndexEntry[]>;
  searchSheets(query: string): Promise<SheetIndexEntry[]>;
  replaceRows(rows: SqliteIndexRow[]): Promise<void>;
}

export interface RuntimeSqliteIndexAdapter {
  rebuildIndex(): Promise<SheetIndexEntry[]>;
  readIndex(): Promise<SheetIndexEntry[]>;
  searchSheets(query: string): Promise<SheetIndexEntry[]>;
}

export interface RuntimeSqliteIndexAdapterOptions {
  files: RuntimeMarkdownFileSource;
  index: RuntimeSqliteIndex;
  hashContent?: (content: string, path: string) => string | Promise<string>;
}

export function createRuntimeSqliteIndexAdapter({
  files,
  index,
  hashContent = hashContentPortable
}: RuntimeSqliteIndexAdapterOptions): RuntimeSqliteIndexAdapter {
  return {
    async rebuildIndex() {
      const paths = (await files.listMarkdownFiles()).slice().sort((left, right) => left.localeCompare(right));
      const rows = await Promise.all(
        paths.map(async (path) => {
          const content = await files.readMarkdownFile(path);
          return markdownFileToSqliteIndexRow(path, content, await hashContent(content, path));
        })
      );
      await index.replaceRows(rows);
      return rows.map((row) => row.entry);
    },

    readIndex() {
      return index.readIndex();
    },

    searchSheets(query) {
      return index.searchSheets(query);
    }
  };
}

export function markdownFileToSqliteIndexRow(
  path: string,
  content: string,
  contentHash = hashContentPortable(content)
): SqliteIndexRow {
  const sheet = parseSheet(content, path);
  return {
    entry: sheetToIndexEntry(sheet),
    body: sheet.body,
    contentHash
  };
}

function sheetToIndexEntry(sheet: SheetDocument): SheetIndexEntry {
  return {
    id: sheet.id,
    path: sheet.path,
    title: sheet.title,
    tags: sheet.tags.map((tag) => tag.path),
    links: sheet.links.map((link) => link.target),
    words: sheet.stats.words,
    updatedAt: sheet.updatedAt?.toISOString()
  };
}

function hashContentPortable(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
