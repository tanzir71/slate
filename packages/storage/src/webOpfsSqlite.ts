import { sqliteIndexSchemaStatements } from "./schema";
import {
  readSqliteIndexEntries,
  replaceSqliteIndexRows,
  searchSqliteIndexEntries,
  type SqliteIndexExecutor,
  type SqliteIndexRow
} from "./sqliteIndexOperations";
import type { SheetIndexEntry } from "./index";
import wasmUrl from "@journeyapps/wa-sqlite/dist/wa-sqlite-async.wasm?url";

export const slateWebOpfsIndexPath = "slate/index.sqlite";
export const sqliteOpenReadWriteCreate = 0x02 | 0x04;

export interface WaSqliteVfs {
  readonly name: string;
  close?: () => Promise<void> | void;
}

export interface WaSqliteApi {
  wasmModule?: unknown;
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
  createVfs = createCooperativeOpfsVfs
}: WebOpfsSqliteIndexOptions = {}): Promise<WebOpfsSqliteIndex> {
  const sqlite3 = await loadSqlite();
  const vfs = await createVfs(sqlite3);
  sqlite3.vfs_register(vfs, false);

  let db: number;
  try {
    db = await sqlite3.open_v2(path, sqliteOpenReadWriteCreate, vfs.name);
    try { await ensureWebOpfsIndexSchema(sqlite3, db); }
    catch (error) { await sqlite3.close(db); throw error; }
  } catch (error) {
    await vfs.close?.();
    throw error;
  }
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
    import("@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs"),
    import("@journeyapps/wa-sqlite")
  ]);
  const moduleFactory = readModuleFactory(factoryModule);
  const sqliteWasmModule = await moduleFactory({ locateFile: () => wasmUrl });
  const api = sqliteModule.Factory(sqliteWasmModule);
  return {
    wasmModule: sqliteWasmModule,
    vfs_register: (vfs, asDefault) => { api.vfs_register(vfs as Parameters<typeof api.vfs_register>[0], asDefault); },
    open_v2: (path, flags, vfsName) => api.open_v2(path, flags, vfsName),
    exec: (db, statement) => api.exec(db, statement),
    close: (db) => api.close(db),
    async execWithParams(db, statement, bindValues = []) {
      const rows: unknown[][] = [];
      let columns: string[] = [];
      for await (const prepared of api.statements(db, statement)) {
        api.bind_collection(prepared, bindValues as Parameters<typeof api.bind_collection>[1]);
        columns = api.column_names(prepared);
        while (await api.step(prepared) === sqliteModule.SQLITE_ROW) rows.push(api.row(prepared));
      }
      return { rows, columns };
    }
  };
}

async function createCooperativeOpfsVfs(sqlite3: WaSqliteApi): Promise<WaSqliteVfs> {
  if (!isOpfsAvailable()) {
    throw new Error("OPFS storage is unavailable; run the web SQLite adapter in an OPFS-capable worker.");
  }

  const { OPFSCoopSyncVFS } = await import(
    "@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js"
  );
  return OPFSCoopSyncVFS.create("slate-opfs", sqlite3.wasmModule);
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
