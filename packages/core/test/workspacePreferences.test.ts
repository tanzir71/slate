import { describe, expect, it } from "vitest";
import { readWorkspacePreferences } from "../src/workspacePreferences";

describe("portable workspace preferences", () => {
  it("defaults absent fields, removes duplicates and preserves unknown fields", () => {
    expect(readWorkspacePreferences()).toEqual({
      version: 1,
      pinned: [],
      collapsedNotebooks: [],
      density: "comfortable",
    });
    expect(
      readWorkspacePreferences({
        version: 1,
        pinned: ["a.md", "a.md"],
        collapsedNotebooks: ["Work"],
        density: "compact",
        future: { keep: true },
      }),
    ).toEqual({
      version: 1,
      pinned: ["a.md"],
      collapsedNotebooks: ["Work"],
      density: "compact",
      future: { keep: true },
    });
  });
  it.each([
    null,
    [],
    1,
    {},
    { version: 2 },
    { version: 1, pinned: [2] },
    { version: 1, collapsedNotebooks: [""] },
    { version: 1, pinned: "file.md" },
    { version: 1, density: "unknown" },
  ])("rejects invalid data rather than silently replacing it: %j", (value) => {
    expect(() => readWorkspacePreferences(value)).toThrow();
  });
});
