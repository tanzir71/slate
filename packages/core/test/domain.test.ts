import { describe, expect, it } from "vitest";
import {
  buildBacklinkIndex,
  evaluateSmartFilter,
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

  it("round-trips canonical Markdown byte-for-byte", () => {
    const markdown = `---
title: Stable
tags:
  - draft
---
# Stable

- [ ] keep Markdown stable
`;

    expect(serializeSheet(parseSheet(markdown, "Stable.md"))).toBe(markdown);
  });
});

