import { sqliteIndexSchemaStatements } from "./schema";
import {
  readSqliteIndexEntries,
  replaceSqliteIndexRows,
  searchSqliteIndexEntries,
  type SqliteIndexRow
} from "./sqliteIndexOperations";
import type { SheetIndexEntry } from "./index";

export const slateTauriSqliteIndexPath = "sqlite:slate-index.sqlite";

export interface TauriSqliteDatabase {
  execute(statement: string, bindValues?: unknown[]): Promise<unknown>;
  select<Row = Record<string, unknown>>(statement: string, bindValues?: unknown[]): Promise<Row[]>;
}

export type LoadTauriSqliteDatabase = (path: string) => Promise<TauriSqliteDatabase>;

export interface TauriSqliteIndexOptions {
  path?: string;
  loadDatabase?: LoadTauriSqliteDatabase;
}

export interface TauriSqliteIndex {
  path: string;
  database: TauriSqliteDatabase;
  readIndex(): Promise<SheetIndexEntry[]>;
  searchSheets(query: string): Promise<SheetIndexEntry[]>;
  replaceRows(rows: SqliteIndexRow[]): Promise<void>;
}

export async function loadTauriSqliteIndex({
  path = slateTauriSqliteIndexPath,
  loadDatabase = loadPluginDatabase
}: TauriSqliteIndexOptions = {}): Promise<TauriSqliteIndex> {
  const database = await loadDatabase(path);
  await ensureTauriSqliteIndexSchema(database);
  return {
    path,
    database,
    readIndex: () => readSqliteIndexEntries(database),
    searchSheets: (query) => searchSqliteIndexEntries(database, query),
    replaceRows: (rows) => replaceSqliteIndexRows(database, rows)
  };
}

export async function ensureTauriSqliteIndexSchema(database: TauriSqliteDatabase): Promise<void> {
  for (const statement of sqliteIndexSchemaStatements) {
    await database.execute(statement);
  }
}

async function loadPluginDatabase(path: string): Promise<TauriSqliteDatabase> {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  return Database.load(path);
}
