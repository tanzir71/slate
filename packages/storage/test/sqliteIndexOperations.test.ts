import { describe, expect, it } from "vitest";
import {
  readSqliteIndexEntries,
  replaceSqliteIndexRows,
  searchSqliteIndexEntries,
  type SqliteIndexExecutor
} from "../src/sqliteIndexOperations";

describe("shared SQLite index operations", () => {
  it("reads index entries from generic SQL rows", async () => {
    const executor: SqliteIndexExecutor = {
      execute: async () => ({}),
      select: async () => [
        {
          id: "sheet-1",
          path: "Drafts/one.md",
          title: "One",
          body: "# One",
          tags_json: JSON.stringify(["draft", "work/writing"]),
          links_json: JSON.stringify(["Two"]),
          words: 2,
          updated_at: "2026-07-10T00:00:00.000Z",
          content_hash: "hash-one"
        }
      ]
    };

    await expect(readSqliteIndexEntries(executor)).resolves.toEqual([
      {
        id: "sheet-1",
        path: "Drafts/one.md",
        title: "One",
        tags: ["draft", "work/writing"],
        links: ["Two"],
        words: 2,
        updatedAt: "2026-07-10T00:00:00.000Z"
      }
    ]);
  });

  it("searches the FTS table with sanitized terms", async () => {
    const selected: Array<{ statement: string; bindValues?: unknown[] }> = [];
    const executor: SqliteIndexExecutor = {
      execute: async () => ({}),
      select: async (statement, bindValues) => {
        selected.push({ statement, bindValues });
        return [];
      }
    };

    await searchSqliteIndexEntries(executor, "#draft launch-plan");

    expect(selected).toHaveLength(1);
    expect(selected[0]?.statement).toContain("WHERE sheets_fts MATCH ?");
    expect(selected[0]?.bindValues).toEqual(['"draft" "launch-plan"']);
  });

  it("replaces all index rows transactionally", async () => {
    const executed: Array<{ statement: string; bindValues?: unknown[] }> = [];
    const executor: SqliteIndexExecutor = {
      execute: async (statement, bindValues) => {
        executed.push({ statement, bindValues });
        return {};
      },
      select: async () => []
    };

    await replaceSqliteIndexRows(executor, [
      {
        entry: {
          id: "sheet-1",
          path: "Drafts/one.md",
          title: "One",
          tags: ["draft"],
          links: ["Two"],
          words: 2,
          updatedAt: undefined
        },
        body: "# One",
        contentHash: "hash-one"
      }
    ]);

    expect(executed[0]?.statement).toBe("BEGIN IMMEDIATE");
    expect(executed[1]?.statement).toBe("DELETE FROM sheets_fts");
    expect(executed[2]?.statement).toBe("DELETE FROM sheets");
    expect(executed.at(-1)?.statement).toBe("COMMIT");
    expect(executed.some((call) => call.statement.includes("INSERT INTO sheets "))).toBe(true);
    expect(executed.some((call) => call.statement.includes("INSERT INTO sheets_fts "))).toBe(true);
    expect(executed[3]?.bindValues).toContain(JSON.stringify(["draft"]));
  });
});
