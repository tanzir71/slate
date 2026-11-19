import { describe, expect, it } from "vitest";
import { createTauriMarkdownFileSource, type TauriInvoke } from "../src/tauriFileSource";

describe("Tauri Markdown file source", () => {
  it("keeps typed native path errors readable to scanner callers", async () => {
    const source = createTauriMarkdownFileSource({ invoke: async () => { throw { kind: "invalid-path", message: "The path escapes the Space" }; } });
    await expect(source.readMarkdownFile("../outside.md")).rejects.toMatchObject({ kind: "invalid-path", message: "The path escapes the Space" });
    await expect(source.readMarkdownFile("../outside.md")).rejects.toBeInstanceOf(Error);
  });
  it("lists Markdown files through the native command", async () => {
    const calls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
    // The native bridge selects its response type; this fixture supplies a known payload.
    const invoke: TauriInvoke = async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return ["Blog/post.md", "root.md"] as unknown as T;
    };

    const source = createTauriMarkdownFileSource({ invoke });

    await expect(source.listMarkdownFiles()).resolves.toEqual(["Blog/post.md", "root.md"]);
    expect(calls).toEqual([{ command: "list_markdown_files", args: undefined }]);
  });

  it("reads Markdown file text through the native command", async () => {
    const calls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
    // The fixture intentionally models the generic IPC result boundary.
    const invoke: TauriInvoke = async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return "# Post" as unknown as T;
    };

    const source = createTauriMarkdownFileSource({ invoke });

    await expect(source.readMarkdownFile("Blog/post.md")).resolves.toBe("# Post");
    expect(calls).toEqual([{ command: "read_markdown_file", args: { path: "Blog/post.md" } }]);
  });
});
