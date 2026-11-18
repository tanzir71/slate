import { expect, it } from "vitest";
import {
  createWikiPathIndex,
  findWikiPath,
  resolveWikiPath,
  wikiCompletionText,
} from "../src/wikiCompletion";

const pages = [
  { id: "one", path: "Work/Alpha.md", title: "Shared" },
  { id: "two", path: "Home/Alpha.md", title: "Shared" },
  { id: "three", path: "Root.md", title: "Root title" },
];

it.each([
  "Work/Alpha.md",
  "Work/Alpha",
  "./Work/Alpha.md",
  "work/alpha.MD",
  "Work\\Alpha.md",
])("resolves an explicit wiki path %s", (target) => {
  expect(findWikiPath(pages, target)).toBe(pages[0]);
});

it("disambiguates identical titles and respects exact case before a unique case-insensitive match", () => {
  expect(wikiCompletionText(pages[0]!)).toBe("[[Work/Alpha.md|Shared]]");
  expect(wikiCompletionText(pages[1]!)).toBe("[[Home/Alpha.md|Shared]]");
  const mixed = [...pages, { ...pages[0]!, path: "Work/alpha.md" }];
  expect(findWikiPath(mixed, "Work/Alpha")).toBe(pages[0]);
  expect(findWikiPath(mixed, "WORK/ALPHA")).toBeUndefined();
  expect(findWikiPath(pages, "Root.md")).toBe(pages[2]);
});

it("keeps filenames that differ only in extension case distinct", () => {
  const lower = { ...pages[0]!, path: "Note.md" };
  const upper = { ...pages[1]!, path: "Note.MD" };
  const index = createWikiPathIndex([
    lower,
    upper,
    { ...lower, path: "../invalid.md" },
  ]);
  expect(resolveWikiPath(index, "Note.md")).toBe(lower);
  expect(resolveWikiPath(index, "Note.MD")).toBe(upper);
  expect(resolveWikiPath(index, "./Note")).toBeUndefined();
  expect(resolveWikiPath(index, "NOTE.md")).toBeUndefined();
  expect(
    resolveWikiPath(createWikiPathIndex([lower, lower]), "Note.md"),
  ).toBeUndefined();
});

it.each([
  "Shared",
  "Missing.md",
  "../Work/Alpha.md",
  "/Work/Alpha.md",
  "Work//Alpha.md",
  "Work/Alpha.md\n",
  "Work/Alpha.md\0",
])("leaves missing or invalid references unresolved: %j", (target) => {
  expect(findWikiPath(pages, target)).toBeUndefined();
});

it("uses a stable ID when a filename cannot be represented as a wiki target", () => {
  const target = {
    id: "01j22222222222222222222222",
    path: "Notes/Bad]name.md",
    title: "Good | title",
  };
  expect(wikiCompletionText(target)).toBe(
    "[[id:01J22222222222222222222222|Good | title]]",
  );
  expect(wikiCompletionText({ ...target, id: "local_id" })).toBeUndefined();
  expect(wikiCompletionText({ ...pages[0]!, title: "unsafe]label" })).toBe(
    "[[Work/Alpha.md]]",
  );
  expect(wikiCompletionText({ ...pages[0]!, title: "Work/Alpha.md" })).toBe(
    "[[Work/Alpha.md]]",
  );
});

it("keeps Unicode, quotes and spaces literal without emitting multiline references", () => {
  expect(
    wikiCompletionText({
      id: "one",
      path: 'Ideas/বাংলা "one".md',
      title: "বাংলা 🌿",
    }),
  ).toBe('[[Ideas/বাংলা "one".md|বাংলা 🌿]]');
  expect(
    wikiCompletionText({ ...pages[0]!, path: "../outside.md" }),
  ).toBeUndefined();
  expect(wikiCompletionText({ ...pages[0]!, path: "" })).toBeUndefined();
  expect(wikiCompletionText({ ...pages[0]!, title: "line\nbreak" })).toBe(
    "[[Work/Alpha.md]]",
  );
});
