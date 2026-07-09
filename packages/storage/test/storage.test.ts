import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalStorageAdapter } from "../src/index";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "slate-storage-"));
  roots.push(root);
  return root;
}

describe("local storage adapter", () => {
  it("rebuilds an index cache from Markdown files without mutating source files", async () => {
    const root = await makeRoot();
    const adapter = createLocalStorageAdapter(root);
    await adapter.ensureSpace({ name: "Work", color: "#326bff", icon: "briefcase" });
    await adapter.writeSheet("Blog/post.md", `---\ntitle: Post\ntags: [draft]\n---\n# Post\n\nBody #writing\n`);

    const before = await readFile(join(root, "Blog/post.md"), "utf8");
    const first = await adapter.rebuildIndex();
    await rm(join(root, ".slate/index.sqlite"), { force: true });
    const second = await adapter.rebuildIndex();
    const after = await readFile(join(root, "Blog/post.md"), "utf8");

    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      path: "Blog/post.md",
      title: "Post",
      tags: ["draft", "writing"]
    });
    expect(after).toBe(before);
  });

  it("writes a conflict copy instead of overwriting changed disk content", async () => {
    const root = await makeRoot();
    const adapter = createLocalStorageAdapter(root);
    await adapter.ensureSpace({ name: "Work" });
    await adapter.writeSheet("note.md", "base\n");
    await writeFile(join(root, "note.md"), "external change\n");

    const result = await adapter.writeSheet("note.md", "local change\n", {
      baseContent: "base\n",
      now: new Date("2026-07-09T12:00:00.000Z")
    });

    expect(result.status).toBe("conflict-copy");
    expect(await readFile(join(root, "note.md"), "utf8")).toBe("external change\n");
    expect(await readFile(join(root, "note (conflicted copy 2026-07-09 12-00-00).md"), "utf8")).toBe(
      "local change\n"
    );
  });

  it("searches the SQLite FTS index by title, body text, and tags", async () => {
    const root = await makeRoot();
    const adapter = createLocalStorageAdapter(root);
    await adapter.ensureSpace({ name: "Work" });
    await adapter.writeSheet("Blog/launch.md", "---\ntitle: Launch Plan\ntags: [product]\n---\n# Launch\n\nShip calmly.\n");
    await adapter.writeSheet("Research/interview.md", "# Interview\n\nA note about quiet writing #research/user\n");
    await adapter.rebuildIndex();

    await expect(adapter.searchSheets("launch")).resolves.toMatchObject([{ path: "Blog/launch.md" }]);
    await expect(adapter.searchSheets("quiet")).resolves.toMatchObject([{ path: "Research/interview.md" }]);
    await expect(adapter.searchSheets("#product")).resolves.toMatchObject([{ path: "Blog/launch.md" }]);
  });

  it("moves sheets on disk and refreshes the SQLite index path", async () => {
    const root = await makeRoot();
    const adapter = createLocalStorageAdapter(root);
    await adapter.ensureSpace({ name: "Work" });
    await adapter.writeSheet("Drafts/note.md", "# Note\n\nA searchable espresso note.\n");
    await adapter.rebuildIndex();

    await adapter.moveSheet("Drafts/note.md", "Archive/note.md");

    await expect(readFile(join(root, "Drafts/note.md"), "utf8")).rejects.toThrow();
    await expect(readFile(join(root, "Archive/note.md"), "utf8")).resolves.toBe(
      "# Note\n\nA searchable espresso note.\n"
    );
    await expect(adapter.readIndex()).resolves.toMatchObject([{ path: "Archive/note.md" }]);
    await expect(adapter.searchSheets("espresso")).resolves.toMatchObject([{ path: "Archive/note.md" }]);
  });

  it("refuses to overwrite an existing sheet when moving", async () => {
    const root = await makeRoot();
    const adapter = createLocalStorageAdapter(root);
    await adapter.ensureSpace({ name: "Work" });
    await adapter.writeSheet("Drafts/source.md", "# Source\n");
    await adapter.writeSheet("Archive/source.md", "# Existing\n");

    await expect(adapter.moveSheet("Drafts/source.md", "Archive/source.md")).rejects.toThrow(
      "destination already exists"
    );
    await expect(readFile(join(root, "Drafts/source.md"), "utf8")).resolves.toBe("# Source\n");
    await expect(readFile(join(root, "Archive/source.md"), "utf8")).resolves.toBe("# Existing\n");
  });

  it("auto-rebuilds a corrupted SQLite index from Markdown files", async () => {
    const root = await makeRoot();
    const adapter = createLocalStorageAdapter(root);
    await adapter.ensureSpace({ name: "Work" });
    await adapter.writeSheet("note.md", "---\ntitle: Durable Note\n---\nBody\n");
    await adapter.rebuildIndex();
    await writeFile(join(root, ".slate/index.sqlite"), "not a sqlite database");

    const entries = await adapter.readIndex();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ path: "note.md", title: "Durable Note" });
    await expect(adapter.searchSheets("durable")).resolves.toHaveLength(1);
  });

  it("reconciles external create, update, and delete changes into the index", async () => {
    const root = await makeRoot();
    const adapter = createLocalStorageAdapter(root);
    await adapter.ensureSpace({ name: "Work" });
    await adapter.writeSheet("old.md", "# Old\n\nThis will disappear.\n");
    await adapter.writeSheet("changed.md", "# Changed\n\nInitial body.\n");
    await adapter.rebuildIndex();

    await unlink(join(root, "old.md"));
    await writeFile(join(root, "changed.md"), "# Changed\n\nExternally edited body with espresso keyword.\n");
    await mkdir(join(root, "Inbox"), { recursive: true });
    await writeFile(join(root, "Inbox/new.md"), "# New\n\nFresh external note.\n");

    const result = await adapter.reconcileExternalChanges();

    expect(result.added).toEqual(["Inbox/new.md"]);
    expect(result.updated).toEqual(["changed.md"]);
    expect(result.deleted).toEqual(["old.md"]);
    await expect(adapter.searchSheets("espresso")).resolves.toMatchObject([{ path: "changed.md" }]);
  });

  it("notifies within 500ms when external Markdown files change", async () => {
    const root = await makeRoot();
    const adapter = createLocalStorageAdapter(root);
    await adapter.ensureSpace({ name: "Work" });
    await adapter.rebuildIndex();

    const changed = new Promise<string[]>((resolve) => {
      const watcher = adapter.watchSpace((event) => {
        watcher.close();
        resolve(event.added);
      }, { intervalMs: 50 });
    });
    await writeFile(join(root, "watched.md"), "# Watched\n\nExternal change.\n");

    await expect(Promise.race([changed, timeoutAfter(500)])).resolves.toEqual(["watched.md"]);
  });
});

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
}
