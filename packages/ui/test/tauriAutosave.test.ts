import { describe, expect, it } from "vitest";
import { createTauriAutosaveWriter, type TauriInvoke } from "../src/tauriAutosave";

describe("Tauri autosave writer", () => {
  it("invokes the desktop write command with conflict-base content", async () => {
    const calls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
    const invoke: TauriInvoke = async (command, args) => {
      calls.push({ command, args });
      return { status: "written", path: "Drafts/note.md" };
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
    const invoke: TauriInvoke = async () => ({
      status: "conflict-copy",
      path: "Drafts/note (conflicted copy 2026-07-10 00-00-00).md"
    });
    const writer = createTauriAutosaveWriter({ invoke });

    await expect(writer.writeSheet("Drafts/note.md", "# Draft", {})).resolves.toEqual({
      status: "conflict-copy",
      path: "Drafts/note (conflicted copy 2026-07-10 00-00-00).md"
    });
  });
});
