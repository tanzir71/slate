import { expect, it } from "vitest";
import { parseNativeLaunchURL } from "../src/native/nativeLaunchURL";

it("decodes a native creation URI without normalizing its literal text or opaque Space ID", () => {
  const text = "\uFEFF# বাংলা\r\nKept\r\n";
  const request = parseNativeLaunchURL("slate://new?" + new URLSearchParams({ title: "Linked", notebook: "Work", text, space: "opaque" }));
  expect(request.error).toBe("");
  expect(request.action).toEqual({ kind: "new", notebook: "Work", title: "Linked", text, space: "opaque" });
  expect(request.files).toEqual([]);
});
it("supports native open, append, search and preview links with web-compatible fields", () => {
  expect(parseNativeLaunchURL("slate://open?path=Work%2Fnote.md").action).toEqual({ kind: "open", path: "Work/note.md" });
  expect(parseNativeLaunchURL("slate://append?path=note.md&text=more%0D%0A").action).toEqual({ kind: "append", path: "note.md", text: "more\r\n" });
  expect(parseNativeLaunchURL("slate-preview://search?q=exact+words").action).toEqual({ kind: "search", query: "exact words" });
  expect(parseNativeLaunchURL("slate://new?template=Meeting%3A+notes").action).toMatchObject({ kind: "new", template: "Meeting: notes" });
});
it.each([
  "https://new?title=Outside", "file:///notes.md", "slate:new?title=Opaque", "slate://user@new", "slate://new:123",
  "slate://new/extra", "slate://new#fragment", "slate://new?action=append", "slate://new?title=one&title=two",
  "slate://open", "slate://open?path=../outside.md", "slate://append?path=.slate/config.md&text=no", "slate://open?path=C%3A%2Foutside.md",
  "slate://open?path=CON.md", "slate://append?path=note.md", "slate://today", "slate://search?path=note.md",
])("rejects unsafe or ambiguous native URI %s before it can become an action", uri => {
  const request = parseNativeLaunchURL(uri); expect(request.action).toBeUndefined(); expect(request.error).not.toBe(""); expect(request.files).toEqual([]);
});
