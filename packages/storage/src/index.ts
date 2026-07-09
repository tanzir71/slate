import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { parseSheet, type SheetDocument } from "@slate/core";
import { sqliteIndexSchema } from "./schema";

export interface SpaceMetadata {
  id?: string;
  name: string;
  color?: string;
  icon?: string;
}

export interface SheetIndexEntry {
  id: string;
  path: string;
  title: string;
  tags: string[];
  links: string[];
  words: number;
  updatedAt: string | undefined;
}

export interface ReconcileResult {
  added: string[];
  updated: string[];
  deleted: string[];
  entries: SheetIndexEntry[];
}

export interface WriteSheetOptions {
  baseContent?: string;
  now?: Date;
}

export interface WriteSheetResult {
  status: "written" | "conflict-copy";
  path: string;
}

export interface WatchOptions {
  intervalMs?: number;
}

export interface SpaceWatcher {
  close(): void;
}

export interface LocalStorageAdapter {
  ensureSpace(metadata: SpaceMetadata): Promise<SpaceMetadata & { id: string }>;
  rebuildIndex(): Promise<SheetIndexEntry[]>;
  readIndex(): Promise<SheetIndexEntry[]>;
  searchSheets(query: string): Promise<SheetIndexEntry[]>;
  reconcileExternalChanges(): Promise<ReconcileResult>;
  watchSpace(onChange: (event: ReconcileResult) => void, options?: WatchOptions): SpaceWatcher;
  writeSheet(path: string, content: string, options?: WriteSheetOptions): Promise<WriteSheetResult>;
  moveSheet(fromPath: string, toPath: string): Promise<void>;
  deleteSheet(path: string): Promise<void>;
}

const slateDir = ".slate";
const indexFile = "index.sqlite";
export function createLocalStorageAdapter(root: string): LocalStorageAdapter {
  const absoluteRoot = resolve(root);
  const sqlitePath = join(absoluteRoot, slateDir, indexFile);

  return {
    async ensureSpace(metadata) {
      const complete: SpaceMetadata & { id: string } = {
        id: metadata.id ?? stableSpaceId(absoluteRoot),
        name: metadata.name
      };
      if (metadata.color !== undefined) {
        complete.color = metadata.color;
      }
      if (metadata.icon !== undefined) {
        complete.icon = metadata.icon;
      }
      await mkdir(join(absoluteRoot, slateDir), { recursive: true });
      await writeFile(join(absoluteRoot, slateDir, "space.json"), JSON.stringify(complete, null, 2));
      return complete;
    },

    async rebuildIndex() {
      await mkdir(join(absoluteRoot, slateDir), { recursive: true });
      const rows = await readDiskRows(absoluteRoot);
      const sorted = rows.sort((left, right) => left.entry.path.localeCompare(right.entry.path));
      const database = openIndexDatabase(sqlitePath);
      try {
        database.exec("BEGIN IMMEDIATE");
        database.exec("DELETE FROM sheets_fts");
        database.exec("DELETE FROM sheets");

        const insertSheet = database.prepare(`
          INSERT INTO sheets (id, path, title, body, tags_json, links_json, words, updated_at, content_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertFts = database.prepare(`
          INSERT INTO sheets_fts (path, title, body, tags)
          VALUES (?, ?, ?, ?)
        `);

        for (const row of sorted) {
          insertSheet.run(
            row.entry.id,
            row.entry.path,
            row.entry.title,
            row.body,
            JSON.stringify(row.entry.tags),
            JSON.stringify(row.entry.links),
            row.entry.words,
            row.entry.updatedAt ?? null,
            row.contentHash
          );
          insertFts.run(row.entry.path, row.entry.title, row.body, row.entry.tags.join(" "));
        }

        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      } finally {
        database.close();
      }

      return sorted.map((row) => row.entry);
    },

    async readIndex() {
      try {
        const database = openIndexDatabase(sqlitePath);
        try {
          return readIndexEntries(database);
        } finally {
          database.close();
        }
      } catch {
        await removeIndexFiles(sqlitePath);
        return this.rebuildIndex();
      }
    },

    async searchSheets(query) {
      const trimmed = query.trim();
      if (!trimmed) {
        return this.readIndex();
      }

      try {
        const database = openIndexDatabase(sqlitePath);
        try {
          return searchIndexEntries(database, trimmed);
        } finally {
          database.close();
        }
      } catch {
        await removeIndexFiles(sqlitePath);
        await this.rebuildIndex();
        const database = openIndexDatabase(sqlitePath);
        try {
          return searchIndexEntries(database, trimmed);
        } finally {
          database.close();
        }
      }
    },

    async reconcileExternalChanges() {
      const before = await readIndexedRowsOrRebuild(sqlitePath, () => this.rebuildIndex());
      const disk = await readDiskRows(absoluteRoot);
      const indexedByPath = new Map(before.map((row) => [row.entry.path, row]));
      const diskByPath = new Map(disk.map((row) => [row.entry.path, row]));

      const added = disk
        .filter((row) => !indexedByPath.has(row.entry.path))
        .map((row) => row.entry.path)
        .sort();
      const deleted = before
        .filter((row) => !diskByPath.has(row.entry.path))
        .map((row) => row.entry.path)
        .sort();
      const updated = disk
        .filter((row) => {
          const indexed = indexedByPath.get(row.entry.path);
          return indexed !== undefined && indexed.contentHash !== row.contentHash;
        })
        .map((row) => row.entry.path)
        .sort();

      const entries = added.length > 0 || deleted.length > 0 || updated.length > 0 ? await this.rebuildIndex() : before.map((row) => row.entry);

      return { added, updated, deleted, entries };
    },

    watchSpace(onChange, options = {}) {
      const intervalMs = options.intervalMs ?? 250;
      let closed = false;
      let running = false;
      const timer = setInterval(() => {
        if (closed || running) {
          return;
        }

        running = true;
        void this.reconcileExternalChanges()
          .then((event) => {
            if (
              !closed &&
              (event.added.length > 0 || event.updated.length > 0 || event.deleted.length > 0)
            ) {
              onChange(event);
            }
          })
          .finally(() => {
            running = false;
          });
      }, intervalMs);

      timer.unref?.();

      return {
        close() {
          closed = true;
          clearInterval(timer);
        }
      };
    },

    async writeSheet(path, content, options = {}) {
      const target = safeJoin(absoluteRoot, path);
      await mkdir(dirname(target), { recursive: true });

      if (options.baseContent !== undefined) {
        const current = await readExisting(target);
        if (current !== undefined && current !== options.baseContent) {
          const conflict = conflictCopyPath(target, options.now ?? new Date());
          await writeFile(conflict, content);
          return {
            status: "conflict-copy",
            path: toWorkspacePath(relative(absoluteRoot, conflict))
          };
        }
      }

      await writeFile(target, content);
      return { status: "written", path: toWorkspacePath(relative(absoluteRoot, target)) };
    },

    async moveSheet(fromPath, toPath) {
      const from = safeJoin(absoluteRoot, fromPath);
      const to = safeJoin(absoluteRoot, toPath);
      if (await pathExists(to)) {
        throw new Error(`Cannot move sheet because destination already exists: ${toPath}`);
      }
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
      await this.rebuildIndex();
    },

    async deleteSheet(path) {
      await rm(safeJoin(absoluteRoot, path), { force: true });
    }
  };
}

export function createConflictCopyName(filename: string, now: Date): string {
  const extension = extname(filename);
  const basename = extension ? filename.slice(0, -extension.length) : filename;
  const stamp = now.toISOString().slice(0, 19).replace("T", " ").replaceAll(":", "-");
  return `${basename} (conflicted copy ${stamp})${extension}`;
}

interface IndexedRow {
  entry: SheetIndexEntry;
  body: string;
  contentHash: string;
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

async function readDiskRows(root: string): Promise<IndexedRow[]> {
  const markdownFiles = await listMarkdownFiles(root);
  return Promise.all(
    markdownFiles.map(async (absolutePath) => {
      const relativePath = toWorkspacePath(relative(root, absolutePath));
      const raw = await readFile(absolutePath, "utf8");
      const sheet = parseSheet(raw, relativePath);
      return {
        entry: sheetToIndexEntry(sheet),
        body: sheet.body,
        contentHash: hashContent(raw)
      };
    })
  );
}

function openIndexDatabase(path: string): DatabaseSync {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path);
    database.exec(sqliteIndexSchema);
    return database;
  } catch (error) {
    database?.close();
    throw error;
  }
}

function readIndexEntries(database: DatabaseSync): SheetIndexEntry[] {
  return readIndexedRows(database).map((row) => row.entry);
}

function readIndexedRows(database: DatabaseSync): IndexedRow[] {
  return database
    .prepare(
      `
      SELECT id, path, title, body, tags_json, links_json, words, updated_at, content_hash
      FROM sheets
      ORDER BY path ASC
    `
    )
    .all()
    .flatMap(rowToIndexedRow);
}

async function readIndexedRowsOrRebuild(
  sqlitePath: string,
  rebuild: () => Promise<SheetIndexEntry[]>
): Promise<IndexedRow[]> {
  try {
    const database = openIndexDatabase(sqlitePath);
    try {
      return readIndexedRows(database);
    } finally {
      database.close();
    }
  } catch {
    await removeIndexFiles(sqlitePath);
    await rebuild();
    const database = openIndexDatabase(sqlitePath);
    try {
      return readIndexedRows(database);
    } finally {
      database.close();
    }
  }
}

function searchIndexEntries(database: DatabaseSync, query: string): SheetIndexEntry[] {
  const ftsQuery = toFtsQuery(query);
  return database
    .prepare(
      `
      SELECT sheets.id, sheets.path, sheets.title, sheets.body, sheets.tags_json, sheets.links_json,
             sheets.words, sheets.updated_at, sheets.content_hash
      FROM sheets_fts
      JOIN sheets ON sheets.path = sheets_fts.path
      WHERE sheets_fts MATCH ?
      ORDER BY bm25(sheets_fts), sheets.path ASC
    `
    )
    .all(ftsQuery)
    .flatMap(rowToIndexedRow)
    .map((row) => row.entry);
}

function rowToIndexedRow(row: unknown): IndexedRow[] {
  if (!isRecord(row)) {
    return [];
  }

  const id = readString(row.id);
  const path = readString(row.path);
  const title = readString(row.title);
  const body = readString(row.body);
  const tags = parseStringArray(row.tags_json);
  const links = parseStringArray(row.links_json);
  const words = typeof row.words === "number" ? row.words : undefined;
  const contentHash = readString(row.content_hash);

  if (!id || !path || !title || body === undefined || words === undefined || !contentHash) {
    return [];
  }

  return [
    {
      entry: {
        id,
        path,
        title,
        tags,
        links,
        words,
        updatedAt: readString(row.updated_at)
      },
      body,
      contentHash
    }
  ];
}

function toFtsQuery(query: string): string {
  const terms = query
    .replaceAll("#", " ")
    .split(/[^A-Za-z0-9_/.-]+/)
    .map((term) => term.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`);

  return terms.length > 0 ? terms.join(" ") : `"${query.replaceAll('"', '""')}"`;
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === slateDir) {
      continue;
    }

    const absolute = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(absolute)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(absolute);
    }
  }

  return files;
}

async function readExisting(path: string): Promise<string | undefined> {
  try {
    await stat(path);
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function conflictCopyPath(path: string, now: Date): string {
  return join(dirname(path), createConflictCopyName(path.slice(dirname(path).length + 1), now));
}

function safeJoin(root: string, path: string): string {
  const target = resolve(root, path);
  const relativeTarget = relative(root, target);
  if (relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
    throw new Error(`Path escapes Slate space root: ${path}`);
  }
  return target;
}

function toWorkspacePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function stableSpaceId(root: string): string {
  let hash = 5381;
  for (const char of root) {
    hash = (hash * 33) ^ char.charCodeAt(0);
  }
  return `space_${(hash >>> 0).toString(36)}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.flatMap((item) => (typeof item === "string" ? [item] : [])) : [];
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function removeIndexFiles(sqlitePath: string): Promise<void> {
  for (const path of [sqlitePath, `${sqlitePath}-shm`, `${sqlitePath}-wal`]) {
    await retryBusy(() => rm(path, { force: true }));
  }
}

async function retryBusy(action: () => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await action();
      return;
    } catch (error) {
      if (!isBusyError(error) || attempt === 7) {
        throw error;
      }
      await wait(25 * (attempt + 1));
    }
  }
}

function isBusyError(error: unknown): boolean {
  return isRecord(error) && (error.code === "EBUSY" || error.code === "EPERM");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolveWait) => {
    setTimeout(resolveWait, ms);
  });
}
