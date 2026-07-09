import { describe, expect, it } from "vitest";
import { createSyncEngine, mergeOfflineEdits } from "../src/index";

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
});

