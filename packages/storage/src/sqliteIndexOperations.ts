import type { SheetIndexEntry } from "./index";

export interface SqliteIndexExecutor {
  execute(statement: string, bindValues?: unknown[]): Promise<unknown>;
  select<Row = Record<string, unknown>>(statement: string, bindValues?: unknown[]): Promise<Row[]>;
}

export interface SqliteIndexRow {
  entry: SheetIndexEntry;
  body: string;
  contentHash: string;
}

export async function readSqliteIndexEntries(executor: SqliteIndexExecutor): Promise<SheetIndexEntry[]> {
  const rows = await readSqliteIndexRows(executor);
  return rows.map((row) => row.entry);
}

export async function readSqliteIndexRows(executor: SqliteIndexExecutor): Promise<SqliteIndexRow[]> {
  const rows = await executor.select(`
    SELECT id, path, title, body, tags_json, links_json, words, updated_at, content_hash
    FROM sheets
    ORDER BY path ASC
  `);
  return rows.flatMap(rowToSqliteIndexRow);
}

export async function searchSqliteIndexEntries(
  executor: SqliteIndexExecutor,
  query: string
): Promise<SheetIndexEntry[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return readSqliteIndexEntries(executor);
  }

  const rows = await executor.select(
    `
    SELECT sheets.id, sheets.path, sheets.title, sheets.body, sheets.tags_json, sheets.links_json,
           sheets.words, sheets.updated_at, sheets.content_hash
    FROM sheets_fts
    JOIN sheets ON sheets.path = sheets_fts.path
    WHERE sheets_fts MATCH ?
    ORDER BY bm25(sheets_fts), sheets.path ASC
  `,
    [toFtsQuery(trimmed)]
  );
  return rows.flatMap(rowToSqliteIndexRow).map((row) => row.entry);
}

export async function replaceSqliteIndexRows(
  executor: SqliteIndexExecutor,
  rows: SqliteIndexRow[]
): Promise<void> {
  await executor.execute("BEGIN IMMEDIATE");
  try {
    await executor.execute("DELETE FROM sheets_fts");
    await executor.execute("DELETE FROM sheets");

    for (const row of rows) {
      await executor.execute(
        `
        INSERT INTO sheets (id, path, title, body, tags_json, links_json, words, updated_at, content_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          row.entry.id,
          row.entry.path,
          row.entry.title,
          row.body,
          JSON.stringify(row.entry.tags),
          JSON.stringify(row.entry.links),
          row.entry.words,
          row.entry.updatedAt ?? null,
          row.contentHash
        ]
      );
      await executor.execute(
        `
        INSERT INTO sheets_fts (path, title, body, tags)
        VALUES (?, ?, ?, ?)
      `,
        [row.entry.path, row.entry.title, row.body, row.entry.tags.join(" ")]
      );
    }

    await executor.execute("COMMIT");
  } catch (error) {
    await executor.execute("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

function rowToSqliteIndexRow(row: unknown): SqliteIndexRow[] {
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
