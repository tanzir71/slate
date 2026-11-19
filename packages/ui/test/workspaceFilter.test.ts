import { expect, it, vi } from "vitest";
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

it("does not allocate a clock value per sheet for filters that do not read time", () => {
  const sheet = parseSheet("---\nstatus: Draft\ngoal: { type: words, target: 100 }\n---\n# Work\n\nWords #work", "Work/note.md");
  const OriginalDate = Date;
  let clocks = 0, accepted = 0;
  vi.stubGlobal("Date", new Proxy(OriginalDate, { construct(Target, args) { clocks++; return Reflect.construct(Target, args); } }));
  try {
    const filters = ["", "@pinned", "@drafts", "@goals", "#work", "Work"];
    for (let index = 0; index < 10_000; index++) if (matchesWorkspaceFilter(sheet, filters[index % filters.length]!, [sheet.path])) accepted++;
  } finally { vi.unstubAllGlobals(); }
  expect(accepted).toBe(10_000); expect(clocks).toBe(0);
});

it("still reads the current clock for recent files when no reference time is supplied", () => {
  vi.useFakeTimers();
  try {
    const sheet = parseSheet("---\nupdated: 2026-11-17T12:00:00Z\n---\nWords", "Recent.md");
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"));
    expect(matchesWorkspaceFilter(sheet, "@recent", [])).toBe(true);
    vi.setSystemTime(new Date("2026-12-18T12:00:00Z"));
    expect(matchesWorkspaceFilter(sheet, "@recent", [])).toBe(false);
  } finally { vi.useRealTimers(); }
});
