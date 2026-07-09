import { describe, expect, it } from "vitest";
import {
  buildBacklinkIndex,
  evaluateSmartFilter,
  parseMarkdownAst,
  parseSheet,
  serializeSheet
} from "../src/index";

describe("Slate core Markdown domain", () => {
  it("extracts frontmatter, body tags, wiki links, and goal progress", () => {
    const sheet = parseSheet(
      `---
title: Launch Plan
tags: [draft, project/slate]
created: 2026-07-01T10:00:00.000Z
updated: 2026-07-09T10:00:00.000Z
goal: { type: words, target: 6 }
id: 01J00000000000000000000000
---
# Launch Plan

Draft copy for #writing/work and [[Research Notes|research]].
`,
      "Work/Launch Plan.md"
    );

    expect(sheet.title).toBe("Launch Plan");
    expect(sheet.tags.map((tag) => tag.path)).toEqual([
      "draft",
      "project/slate",
      "writing/work"
    ]);
    expect(sheet.links).toEqual([
      {
        raw: "[[Research Notes|research]]",
        target: "Research Notes",
        display: "research",
        targetId: undefined
      }
    ]);
    expect(sheet.goal).toMatchObject({
      type: "words",
      target: 6,
      current: 7,
      complete: true
    });
  });

  it("resolves backlinks by stable id after a target title changes", () => {
    const source = parseSheet(
      `---
title: Source
id: 01J11111111111111111111111
---
See [[01J22222222222222222222222|the renamed note]].
`,
      "Source.md"
    );
    const target = parseSheet(
      `---
title: Renamed Note
id: 01J22222222222222222222222
---
Body.
`,
      "Renamed Note.md"
    );

    const backlinks = buildBacklinkIndex([source, target]);

    expect(backlinks.get(target.id)).toEqual([
      {
        fromId: source.id,
        fromTitle: "Source",
        linkText: "the renamed note",
        raw: "[[01J22222222222222222222222|the renamed note]]"
      }
    ]);
  });

  it("evaluates smart filters across tags, modified age, text, and goal state", () => {
    const now = new Date("2026-07-09T12:00:00.000Z");
    const sheet = parseSheet(
      `---
title: Draft
tags: [draft]
updated: 2026-07-08T12:00:00.000Z
goal: { type: words, target: 100 }
---
Some launch words.
`,
      "Draft.md"
    );

    expect(
      evaluateSmartFilter(sheet, "tag:#draft AND modified:<7d AND text:launch AND goal:incomplete", {
        now
      })
    ).toBe(true);
    expect(evaluateSmartFilter(sheet, "tag:#published OR goal:complete", { now })).toBe(false);
  });

  it("covers smart-filter fallback and invalid predicate edges", () => {
    const now = new Date("2026-07-09T12:00:00.000Z");
    const sheet = parseSheet("# Fallback\n\nPlain body without metadata.", "Inbox/Fallback.md");

    expect(evaluateSmartFilter(sheet, "", { now })).toBe(true);
    expect(evaluateSmartFilter(sheet, "fallback", { now })).toBe(true);
    expect(evaluateSmartFilter(sheet, "modified:<7d", { now })).toBe(false);
    expect(evaluateSmartFilter(sheet, "modified:soon", { now })).toBe(false);
    expect(evaluateSmartFilter(sheet, "goal:complete", { now })).toBe(false);
    expect(evaluateSmartFilter(sheet, "goal:unknown", { now })).toBe(false);
  });

  it("falls back to headings, basenames, stable ids, and undefined metadata", () => {
    const headingSheet = parseSheet("# Heading Title\n\nBody.", "Nested/path.md");
    const basenameSheet = parseSheet("Body without heading.", "Nested/Basename.md");

    expect(headingSheet.title).toBe("Heading Title");
    expect(basenameSheet.title).toBe("Basename");
    expect(basenameSheet.id).toMatch(/^local_/);
    expect(basenameSheet.createdAt).toBeUndefined();
    expect(basenameSheet.updatedAt).toBeUndefined();
    expect(basenameSheet.goal).toBeUndefined();
  });

  it("computes character and reading-time goals", () => {
    const characterGoal = parseSheet(
      `---
goal: { type: characters, target: 8 }
---
alpha beta
`,
      "Character Goal.md"
    );
    const readingTimeGoal = parseSheet(
      `---
goal: { type: readingTimeMinutes, target: 1 }
---
short body
`,
      "Reading Time Goal.md"
    );

    expect(characterGoal.goal).toMatchObject({ current: 9, complete: true });
    expect(readingTimeGoal.goal).toMatchObject({ current: 1, complete: true });
  });

  it("parses GFM Markdown into an AST", () => {
    const ast = parseMarkdownAst(`- [x] Ship Slate

| App | Format |
| --- | --- |
| Slate | Markdown |
`) as { type?: string; children?: unknown[] };

    expect(ast.type).toBe("root");
    expect(ast.children?.length).toBeGreaterThan(0);
  });

  it("round-trips canonical Markdown byte-for-byte", () => {
    const examples = [
      `---
title: Stable
tags:
  - draft
---
# Stable

- [ ] keep Markdown stable
`,
      `# Plain Sheet

Body with [[Wiki Link|display]] and #nested/tag.
`,
      `---
title: Dates
created: 2026-07-01T10:00:00.000Z
updated: 2026-07-09T10:00:00.000Z
---
## Section

Canonical date metadata.
`
    ];

    for (const markdown of examples) {
      expect(serializeSheet(parseSheet(markdown, "Stable.md"))).toBe(markdown);
    }
  });
});
