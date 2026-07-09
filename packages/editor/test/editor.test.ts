import { describe, expect, it } from "vitest";
import { computeEditorHud, findInactiveMarkdownMarkerRanges } from "../src/index";

describe("editor helpers", () => {
  it("computes the live HUD from Markdown text", () => {
    expect(computeEditorHud("# Title\n\nDraft copy for #writing/work.")).toMatchObject({
      words: 5,
      characters: 24,
      readingTimeMinutes: 1
    });
  });

  it("finds Markdown syntax markers outside the active line for Bear-style hiding", () => {
    const markdown = "# Title\n\nThis is **bold** and [[Target|label]].\nActive **line**.";
    const ranges = findInactiveMarkdownMarkerRanges(markdown, 4);

    expect(ranges.map((range) => markdown.slice(range.from, range.to))).toEqual([
      "#",
      "**",
      "**",
      "[[",
      "|",
      "]]"
    ]);
    expect(ranges.every((range) => range.line !== 4)).toBe(true);
  });
});

