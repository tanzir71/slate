import { describe, expect, it } from "vitest";
import { createRuntimeSqliteIndexAdapter, type RuntimeSqliteIndex } from "../src/runtimeSqliteAdapter";
import type { SqliteIndexRow } from "../src/sqliteIndexOperations";

describe("runtime SQLite index adapter", () => {
  it("rebuilds the SQL index from an abstract Markdown file source", async () => {
    const replacedRows: SqliteIndexRow[][] = [];
    const index: RuntimeSqliteIndex = {
      readIndex: async () => [],
      searchSheets: async () => [],
      replaceRows: async (rows) => {
        replacedRows.push(rows);
      }
    };
    const adapter = createRuntimeSqliteIndexAdapter({
      index,
      files: {
        listMarkdownFiles: async () => ["Research/two.md", "Drafts/one.md"],
        readMarkdownFile: async (path) =>
          path === "Drafts/one.md"
            ? `---
title: One
tags: [draft]
id: 01J11111111111111111111111
---
# One
`
            : `---
title: Two
id: 01J22222222222222222222222
---
# Two

Links to [[One]].
`
      }
    });

    const entries = await adapter.rebuildIndex();

    expect(entries.map((entry) => entry.path)).toEqual(["Drafts/one.md", "Research/two.md"]);
    expect(replacedRows).toHaveLength(1);
    expect(replacedRows[0]?.map((row) => row.entry.title)).toEqual(["One", "Two"]);
    expect(replacedRows[0]?.[1]?.entry.links).toEqual(["One"]);
    expect(replacedRows[0]?.[0]?.contentHash).toMatch(/^fnv1a-/);
  });

  it("delegates read and search operations to the SQL index", async () => {
    const searched: string[] = [];
    const index: RuntimeSqliteIndex = {
      readIndex: async () => [
        {
          id: "sheet-1",
          path: "Drafts/one.md",
          title: "One",
          tags: ["draft"],
          links: [],
          words: 1,
          updatedAt: undefined
        }
      ],
      searchSheets: async (query) => {
        searched.push(query);
        return [];
      },
      replaceRows: async () => undefined
    };
    const adapter = createRuntimeSqliteIndexAdapter({
      index,
      files: {
        listMarkdownFiles: async () => [],
        readMarkdownFile: async () => ""
      }
    });

    await expect(adapter.readIndex()).resolves.toHaveLength(1);
    await adapter.searchSheets("draft");

    expect(searched).toEqual(["draft"]);
  });
});
