import { describe, expect, it } from "vitest";
import { loadTauriSqliteIndex, slateTauriSqliteIndexPath } from "../src/tauriSql";

describe("Tauri SQL index wiring", () => {
  it("loads the app-relative Slate SQLite index and applies the schema", async () => {
    const loadedPaths: string[] = [];
    const executedStatements: string[] = [];

    const index = await loadTauriSqliteIndex({
      loadDatabase: async (path) => {
        loadedPaths.push(path);
        return {
          execute: async (statement) => {
            executedStatements.push(statement);
            return {};
          },
          select: async () => []
        };
      }
    });

    expect(index.path).toBe(slateTauriSqliteIndexPath);
    expect(loadedPaths).toEqual(["sqlite:slate-index.sqlite"]);
    expect(executedStatements).toHaveLength(2);
    expect(executedStatements[0]).toContain("CREATE TABLE IF NOT EXISTS sheets");
    expect(executedStatements[1]).toContain("CREATE VIRTUAL TABLE IF NOT EXISTS sheets_fts USING fts5");
  });

  it("exposes shared read and search operations over the native SQL database", async () => {
    const selected: Array<{ statement: string; bindValues?: unknown[] }> = [];
    const index = await loadTauriSqliteIndex({
      loadDatabase: async () => ({
        execute: async () => ({}),
        select: async (statement, bindValues) => {
          selected.push({ statement, bindValues });
          return [
            {
              id: "sheet-1",
              path: "Drafts/one.md",
              title: "One",
              body: "# One",
              tags_json: JSON.stringify(["draft"]),
              links_json: JSON.stringify([]),
              words: 2,
              updated_at: null,
              content_hash: "hash-one"
            }
          ];
        }
      })
    });

    await expect(index.readIndex()).resolves.toEqual([
      {
        id: "sheet-1",
        path: "Drafts/one.md",
        title: "One",
        tags: ["draft"],
        links: [],
        words: 2,
        updatedAt: undefined
      }
    ]);
    await index.searchSheets("draft");

    expect(selected.at(-1)?.statement).toContain("WHERE sheets_fts MATCH ?");
    expect(selected.at(-1)?.bindValues).toEqual(['"draft"']);
  });

  it("allows callers to choose a different native SQLite database path", async () => {
    const loadedPaths: string[] = [];

    await loadTauriSqliteIndex({
      path: "sqlite:space-work-index.sqlite",
      loadDatabase: async (path) => {
        loadedPaths.push(path);
        return {
          execute: async () => ({}),
          select: async () => []
        };
      }
    });

    expect(loadedPaths).toEqual(["sqlite:space-work-index.sqlite"]);
  });
});
