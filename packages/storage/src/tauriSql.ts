import { sqliteIndexSchemaStatements } from "./schema";

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
}

export async function loadTauriSqliteIndex({
  path = slateTauriSqliteIndexPath,
  loadDatabase = loadPluginDatabase
}: TauriSqliteIndexOptions = {}): Promise<TauriSqliteIndex> {
  const database = await loadDatabase(path);
  await ensureTauriSqliteIndexSchema(database);
  return { path, database };
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
