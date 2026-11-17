import { expect, it } from "vitest";
import { parseSheet } from "@slate/core";
import { matchesWorkspaceFilter } from "../src/browser/workspaceFilter";

it("matches real pins, draft/goal/date metadata, tag descendants and notebook boundaries", () => {
  const sheet = parseSheet(
    "---\nstatus: Draft\nupdated: 2026-11-17T12:00:00Z\ngoal: { type: words, target: 100 }\n---\n# Draft\n\nWork #work/project",
    "Work/Projects/note.md",
  );
  const now = new Date("2026-11-18T12:00:00Z");
  for (const filter of [
    "",
    "@pinned",
    "@drafts",
    "@goals",
    "@recent",
    "#work",
    "#work/project",
    "Work",
    "Work/Projects",
  ])
    expect(
      matchesWorkspaceFilter(sheet, filter, [sheet.path], now),
      filter,
    ).toBe(true);
  for (const filter of ["#wor", "Work/Project", "Other"])
    expect(
      matchesWorkspaceFilter(sheet, filter, [sheet.path], now),
      filter,
    ).toBe(false);
  expect(matchesWorkspaceFilter(sheet, "@pinned", [], now)).toBe(false);
  expect(
    matchesWorkspaceFilter(
      sheet,
      "@recent",
      [],
      new Date("2026-12-18T12:00:00Z"),
    ),
  ).toBe(false);
  const complete = parseSheet(
    "---\nstatus: Published\ngoal: { type: words, target: 1 }\n---\nWords already here.",
    "Other.md",
  );
  expect(matchesWorkspaceFilter(complete, "@drafts", [], now)).toBe(false);
  expect(matchesWorkspaceFilter(complete, "@goals", [], now)).toBe(false);
  expect(matchesWorkspaceFilter(complete, "@recent", [], now)).toBe(false);
});
