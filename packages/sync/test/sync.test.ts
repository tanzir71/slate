import { describe, expect, it } from "vitest";
import { createSyncEngine, mergeOfflineEdits, reconcileByoFolderFile } from "../src/index";

describe("sync safety", () => {
  it("merges two offline edits deterministically without losing either edit", () => {
    const base = "# Plan\n\nShared opening.\n";
    const left = "# Plan\n\nShared opening.\n\nLeft client note.\n";
    const right = "# Plan\n\nShared opening.\n\nRight client note.\n";

    const leftFirst = mergeOfflineEdits({ base, left, right });
    const rightFirst = mergeOfflineEdits({ base, left: right, right: left });

    expect(leftFirst.merged).toBe(rightFirst.merged);
    expect(leftFirst.merged).toContain("Left client note.");
    expect(leftFirst.merged).toContain("Right client note.");
    expect(leftFirst.lostData).toBe(false);
  });

  it("keeps the hosted Slate Sync engine disabled behind a feature flag", () => {
    const engine = createSyncEngine({ slateSyncEnabled: false });

    expect(engine.status).toBe("disabled");
    expect(engine.remoteKind).toBe("stub");
  });

  it("accepts BYO-folder edits when the local sheet is unchanged", () => {
    const action = reconcileByoFolderFile({
      path: "Drafts/plan.md",
      baseContent: "# Plan\n\nBase text.\n",
      localContent: "# Plan\n\nBase text.\n",
      externalContent: "# Plan\n\nEdited from Dropbox.\n",
      now: new Date("2026-07-10T03:04:05.000Z")
    });

    expect(action).toEqual({
      type: "accept-external",
      path: "Drafts/plan.md",
      content: "# Plan\n\nEdited from Dropbox.\n"
    });
  });

  it("merges non-overlapping BYO-folder appends without losing either side", () => {
    const base = "# Plan\n\nBase text.\n";
    const action = reconcileByoFolderFile({
      path: "Drafts/plan.md",
      baseContent: base,
      localContent: `${base}\nLocal app note.\n`,
      externalContent: `${base}\nExternal sync note.\n`,
      now: new Date("2026-07-10T03:04:05.000Z")
    });

    expect(action.type).toBe("write-merged");
    if (action.type !== "write-merged") {
      throw new Error(`Expected write-merged, received ${action.type}`);
    }
    expect(action.content).toContain("Local app note.");
    expect(action.content).toContain("External sync note.");
    expect(action.lostData).toBe(false);
  });

  it("writes a deterministic conflict copy for divergent BYO-folder edits", () => {
    const action = reconcileByoFolderFile({
      path: "Drafts/plan.md",
      baseContent: "# Plan\n\nBase text.\n",
      localContent: "# Plan\n\nLocal rewrite.\n",
      externalContent: "# Plan\n\nExternal rewrite.\n",
      now: new Date("2026-07-10T03:04:05.000Z")
    });

    expect(action.type).toBe("write-conflict-copy");
    if (action.type !== "write-conflict-copy") {
      throw new Error(`Expected write-conflict-copy, received ${action.type}`);
    }
    expect(action.path).toBe("Drafts/plan.md");
    expect(action.conflictPath).toBe("Drafts/plan (conflicted copy 2026-07-10 03-04-05).md");
    expect(action.content).toBe("# Plan\n\nLocal rewrite.\n");
    expect(action.externalContent).toBe("# Plan\n\nExternal rewrite.\n");
    expect(action.mergedContent).toContain("<<<<<<< slate-client-a");
    expect(action.mergedContent).toContain("Local rewrite.");
    expect(action.mergedContent).toContain("External rewrite.");
    expect(action.lostData).toBe(false);
  });
});
