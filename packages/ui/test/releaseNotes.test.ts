import { describe, expect, it } from "vitest";
import { parseReleaseNotes } from "../src/browser/releaseNotes";

describe("release notes", () => {
  it("reads a release without transforming its text", () => {
    const notes = { version: "0.2.0", title: "Use it today", changes: ["Your words — still yours."] };
    expect(parseReleaseNotes(notes)).toEqual(notes);
  });

  it("rejects malformed release data instead of rendering invalid changes", () => {
    for (const invalid of [null, "release", {}, { version: "", title: "Title", changes: [] }, { version: "0.2.0", title: "Title", changes: [null] }]) {
      expect(() => parseReleaseNotes(invalid)).toThrow("could not be read");
    }
  });
});
