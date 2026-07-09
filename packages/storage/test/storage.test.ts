import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
});

