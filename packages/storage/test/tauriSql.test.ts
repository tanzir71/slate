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
