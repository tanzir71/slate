import { describe, expect, it } from "vitest";
import {
  loadWebOpfsSqliteIndex,
  slateWebOpfsIndexPath,
  sqliteOpenReadWriteCreate
} from "../src/webOpfsSqlite";

describe("web OPFS wa-sqlite index wiring", () => {
  it("registers the OPFS VFS, opens the Slate index, and applies the schema", async () => {
    const registered: Array<{ name: string; asDefault: boolean }> = [];
    const opened: Array<{ path: string; flags: number; vfsName: string }> = [];
    const executed: string[] = [];
    const closedDatabases: number[] = [];
    let vfsClosed = false;

    const index = await loadWebOpfsSqliteIndex({
      loadSqlite: async () => ({
        vfs_register: (vfs, asDefault) => {
          registered.push({ name: vfs.name, asDefault });
        },
        open_v2: async (path, flags, vfsName) => {
          opened.push({ path, flags, vfsName });
          return 42;
        },
        exec: async (_db, statement) => {
          executed.push(statement);
          return 0;
        },
        close: async (db) => {
          closedDatabases.push(db);
          return 0;
        }
      }),
      createVfs: () => ({
        name: "opfs",
        close: () => {
          vfsClosed = true;
        }
      })
    });

    expect(index.path).toBe(slateWebOpfsIndexPath);
    expect(index.db).toBe(42);
    expect(registered).toEqual([{ name: "opfs", asDefault: false }]);
    expect(opened).toEqual([
      { path: "slate/index.sqlite", flags: sqliteOpenReadWriteCreate, vfsName: "opfs" }
    ]);
    expect(executed).toHaveLength(2);
    expect(executed[0]).toContain("CREATE TABLE IF NOT EXISTS sheets");
    expect(executed[1]).toContain("CREATE VIRTUAL TABLE IF NOT EXISTS sheets_fts USING fts5");

    await index.close();
    expect(closedDatabases).toEqual([42]);
    expect(vfsClosed).toBe(true);
  });

  it("allows callers to choose a per-space OPFS database path", async () => {
    const openedPaths: string[] = [];

    await loadWebOpfsSqliteIndex({
      path: "spaces/work/index.sqlite",
      loadSqlite: async () => ({
        vfs_register: () => undefined,
        open_v2: async (path) => {
          openedPaths.push(path);
          return 1;
        },
        exec: async () => 0,
        close: async () => 0
      }),
      createVfs: () => ({ name: "opfs" })
    });

    expect(openedPaths).toEqual(["spaces/work/index.sqlite"]);
  });
});
