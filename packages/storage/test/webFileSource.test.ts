import { describe, expect, it } from "vitest";
import { createWebDirectoryMarkdownFileSource, type WebDirectoryHandle } from "../src/webFileSource";

describe("web directory Markdown file source", () => {
  it("recursively lists Markdown files while ignoring Slate metadata", async () => {
    const source = createWebDirectoryMarkdownFileSource(
      directory({
        Blog: directory({
          "post.md": file("# Post"),
          "draft.txt": file("not markdown")
        }),
        ".slate": directory({
          "internal.md": file("ignore me")
        }),
        "root.md": file("# Root")
      })
    );

    await expect(source.listMarkdownFiles()).resolves.toEqual(["Blog/post.md", "root.md"]);
  });

  it("reads Markdown file text by workspace-relative path", async () => {
    const source = createWebDirectoryMarkdownFileSource(
      directory({
        Blog: directory({
          "post.md": file("# Post")
        })
      })
    );

    await expect(source.readMarkdownFile("Blog/post.md")).resolves.toBe("# Post");
  });

  it("rejects paths that escape the selected directory", async () => {
    const source = createWebDirectoryMarkdownFileSource(directory({ "root.md": file("# Root") }));

    await expect(source.readMarkdownFile("../root.md")).rejects.toThrow("escapes");
  });
});

function directory(entries: Record<string, WebDirectoryHandle | ReturnType<typeof file>>): WebDirectoryHandle {
  return {
    kind: "directory",
    name: "dir",
    async *entries() {
      for (const [name, handle] of Object.entries(entries)) {
        yield [name, { ...handle, name }] as const;
      }
    },
    async getDirectoryHandle(name) {
      const handle = entries[name];
      if (!handle || handle.kind !== "directory") {
        throw new Error(`Missing directory ${name}`);
      }
      return { ...handle, name };
    },
    async getFileHandle(name) {
      const handle = entries[name];
      if (!handle || handle.kind !== "file") {
        throw new Error(`Missing file ${name}`);
      }
      return { ...handle, name };
    }
  };
}

function file(text: string) {
  return {
    kind: "file" as const,
    name: "file",
    async getFile() {
      return {
        text: async () => text
      };
    }
  };
}
