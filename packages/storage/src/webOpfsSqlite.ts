import { sqliteIndexSchemaStatements } from "./schema";
import {
  readSqliteIndexEntries,
  replaceSqliteIndexRows,
  searchSqliteIndexEntries,
  type SqliteIndexExecutor,
  type SqliteIndexRow
} from "./sqliteIndexOperations";
import type { SheetIndexEntry } from "./index";

export const slateWebOpfsIndexPath = "slate/index.sqlite";
export const sqliteOpenReadWriteCreate = 0x02 | 0x04;

export interface WaSqliteVfs {
  readonly name: string;
  close?: () => Promise<void> | void;
}

export interface WaSqliteApi {
  vfs_register(vfs: WaSqliteVfs, asDefault: boolean): void;
  open_v2(path: string, flags?: number, vfsName?: string): Promise<number>;
  exec(db: number, statement: string): Promise<number>;
  execWithParams(
    db: number,
    statement: string,
    bindValues?: unknown[]
  ): Promise<{ rows: unknown[][]; columns: string[] }>;
  close(db: number): Promise<number>;
}

export type LoadWaSqlite = () => Promise<WaSqliteApi>;
export type CreateWaSqliteVfs = (sqlite3: WaSqliteApi) => Promise<WaSqliteVfs> | WaSqliteVfs;

export interface WebOpfsSqliteIndexOptions {
  path?: string;
  loadSqlite?: LoadWaSqlite;
  createVfs?: CreateWaSqliteVfs;
}

export interface WebOpfsSqliteIndex {
  path: string;
  sqlite3: WaSqliteApi;
  db: number;
  vfs: WaSqliteVfs;
  readIndex(): Promise<SheetIndexEntry[]>;
  searchSheets(query: string): Promise<SheetIndexEntry[]>;
  replaceRows(rows: SqliteIndexRow[]): Promise<void>;
  close(): Promise<void>;
}

type SqliteModuleFactory = (config?: object) => Promise<unknown>;

export async function loadWebOpfsSqliteIndex({
  path = slateWebOpfsIndexPath,
  loadSqlite = loadWaSqliteAsync,
  createVfs = createOriginPrivateFileSystemVfs
}: WebOpfsSqliteIndexOptions = {}): Promise<WebOpfsSqliteIndex> {
  const sqlite3 = await loadSqlite();
  const vfs = await createVfs(sqlite3);
  sqlite3.vfs_register(vfs, false);

  const db = await sqlite3.open_v2(path, sqliteOpenReadWriteCreate, vfs.name);
  await ensureWebOpfsIndexSchema(sqlite3, db);
  const executor = createWaSqliteExecutor(sqlite3, db);

  return {
    path,
    sqlite3,
    db,
    vfs,
    readIndex: () => readSqliteIndexEntries(executor),
    searchSheets: (query) => searchSqliteIndexEntries(executor, query),
    replaceRows: (rows) => replaceSqliteIndexRows(executor, rows),
    async close() {
      await sqlite3.close(db);
      await vfs.close?.();
    }
  };
}

export async function ensureWebOpfsIndexSchema(sqlite3: WaSqliteApi, db: number): Promise<void> {
  for (const statement of sqliteIndexSchemaStatements) {
    await sqlite3.exec(db, statement);
  }
}

function createWaSqliteExecutor(sqlite3: WaSqliteApi, db: number): SqliteIndexExecutor {
  return {
    async execute(statement, bindValues) {
      if (bindValues && bindValues.length > 0) {
        await sqlite3.execWithParams(db, statement, bindValues);
        return 0;
      }
      return sqlite3.exec(db, statement);
    },

    async select<Row = Record<string, unknown>>(statement: string, bindValues?: unknown[]): Promise<Row[]> {
      const result = await sqlite3.execWithParams(db, statement, bindValues);
      return result.rows.map((row) => rowToRecord(result.columns, row)) as Row[];
    }
  };
}

function rowToRecord(columns: string[], row: unknown[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  columns.forEach((column, index) => {
    record[column] = row[index];
  });
  return record;
}

export function isOpfsAvailable(): boolean {
  return typeof globalThis.navigator?.storage?.getDirectory === "function";
}

async function loadWaSqliteAsync(): Promise<WaSqliteApi> {
  const [factoryModule, sqliteModule] = await Promise.all([
    import("wa-sqlite/dist/wa-sqlite-async.mjs"),
    import("wa-sqlite")
  ]);
  const moduleFactory = readModuleFactory(factoryModule);
  const sqliteWasmModule = await moduleFactory();
  return sqliteModule.Factory(sqliteWasmModule) as unknown as WaSqliteApi;
}

async function createOriginPrivateFileSystemVfs(): Promise<WaSqliteVfs> {
  if (!isOpfsAvailable()) {
    throw new Error("OPFS storage is unavailable; run the web SQLite adapter in an OPFS-capable worker.");
  }

  const { OriginPrivateFileSystemVFS } = await import(
    "wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js"
  );
  return new OriginPrivateFileSystemVFS();
}

function readModuleFactory(module: unknown): SqliteModuleFactory {
  if (typeof module === "function") {
    return module as SqliteModuleFactory;
  }
  if (isRecord(module) && typeof module.default === "function") {
    return module.default as SqliteModuleFactory;
  }
  throw new Error("Unable to load wa-sqlite async module factory.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
