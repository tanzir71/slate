import { describe, expect, it } from "vitest";
import { createTauriAutosaveWriter, type TauriInvoke } from "../src/tauriAutosave";

describe("Tauri autosave writer", () => {
  it("keeps typed native path errors readable without weakening the error", async () => {
    const writer = createTauriAutosaveWriter({ invoke: async () => { throw { kind: "invalid-path", message: "The path escapes the Space" }; } });
    await expect(writer.writeSheet("../outside.md", "Words", {})).rejects.toMatchObject({ kind: "invalid-path", message: "The path escapes the Space" });
    await expect(writer.writeSheet("../outside.md", "Words", {})).rejects.toBeInstanceOf(Error);
  });
  it("invokes the desktop write command with conflict-base content", async () => {
    const calls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
    // IPC callers select the response type; this fixture returns one known wire payload.
    const invoke: TauriInvoke = async <Result>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return { status: "written", path: "Drafts/note.md" } as unknown as Result;
    };
    const writer = createTauriAutosaveWriter({ invoke });

    const result = await writer.writeSheet("Drafts/note.md", "# Draft", { baseContent: "# Old" });

    expect(result).toEqual({ status: "written", path: "Drafts/note.md" });
    expect(calls).toEqual([
      {
        command: "write_sheet",
        args: {
          path: "Drafts/note.md",
          content: "# Draft",
          baseContent: "# Old"
        }
      }
    ]);
  });

  it("returns conflict-copy responses from the desktop command", async () => {
    const invoke: TauriInvoke = async <Result>() => ({
      status: "conflict-copy",
      path: "Drafts/note (conflicted copy 2026-07-10 00-00-00).md"
    } as unknown as Result);
    const writer = createTauriAutosaveWriter({ invoke });

    await expect(writer.writeSheet("Drafts/note.md", "# Draft", {})).resolves.toEqual({
      status: "conflict-copy",
      path: "Drafts/note (conflicted copy 2026-07-10 00-00-00).md"
    });
  });
});
