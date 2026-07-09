import { describe, expect, it } from "vitest";
import { createTauriMarkdownFileSource, type TauriInvoke } from "../src/tauriFileSource";

describe("Tauri Markdown file source", () => {
  it("lists Markdown files through the native command", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke: TauriInvoke = async (command, args) => {
      calls.push({ command, args });
      return ["Blog/post.md", "root.md"];
    };

    const source = createTauriMarkdownFileSource({ invoke });

    await expect(source.listMarkdownFiles()).resolves.toEqual(["Blog/post.md", "root.md"]);
    expect(calls).toEqual([{ command: "list_markdown_files", args: undefined }]);
  });

  it("reads Markdown file text through the native command", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke: TauriInvoke = async (command, args) => {
      calls.push({ command, args });
      return "# Post";
    };

    const source = createTauriMarkdownFileSource({ invoke });

    await expect(source.readMarkdownFile("Blog/post.md")).resolves.toBe("# Post");
    expect(calls).toEqual([{ command: "read_markdown_file", args: { path: "Blog/post.md" } }]);
  });
});
