import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { appendLaunchText, parseLaunchActionParameters } from "../src/launchAction.js";

const parse = (values: Record<string, string>) => parseLaunchActionParameters(Object.entries(values));

describe("launch action parameters", () => {
  it("leaves ordinary application queries alone", () => {
    expect(parse({ sample: "1", text: "untouched" })).toBeUndefined();
  });
  it("plans a default new sheet and preserves supplied physical text", () => {
    expect(parse({ action: "new" })).toEqual({ kind: "new", notebook: "Inbox", title: "Untitled", text: "" });
    expect(parse({ action: "new", notebook: "Work/Notes", title: "Meeting", text: "\uFEFF# Words\r\n\r\nKept.\r\n" }))
      .toEqual({ kind: "new", notebook: "Work/Notes", title: "Meeting", text: "\uFEFF# Words\r\n\r\nKept.\r\n" });
  });
  it("retains the requested template and Space without reading either", () => {
    expect(parse({ action: "new", template: "builtin:meeting-notes", space: "my-space" }))
      .toEqual({ kind: "new", notebook: "Inbox", title: "Untitled", text: "", template: "builtin:meeting-notes", space: "my-space" });
  });
  it("allows a template to render a human title into its own portable filename", () => {
    expect(parse({ action: "new", template: "builtin:meeting-notes", title: "Meeting: Q4" }))
      .toEqual({ kind: "new", notebook: "Inbox", title: "Meeting: Q4", text: "", template: "builtin:meeting-notes" });
  });
  it("normalizes portable note paths for open and append", () => {
    expect(parse({ action: "open", path: "Notes\\Kept.md" })).toEqual({ kind: "open", path: "Notes/Kept.md" });
    expect(parse({ action: "append", path: "Notes/Kept.MD", text: "More words." }))
      .toEqual({ kind: "append", path: "Notes/Kept.MD", text: "More words." });
  });
  it("keeps the installed-app file-handler route when no note path is supplied", () => {
    expect(parse({ action: "open" })).toEqual({ kind: "open-files" });
  });
  it.each(["../Kept.md", "/Kept.md", "C:\\Kept.md", "Notes//Kept.md", ".slate/settings.md", ".GIT/config.md", "Notes/NUL.md", "Notes/Kept.txt", "Notes/.md"])("rejects non-note or escaping paths: %s", path => {
    expect(() => parse({ action: "open", path })).toThrow();
    expect(() => parse({ action: "append", path, text: "Words" })).toThrow();
  });
  it.each(["../Notes", "/Notes", ".slate", ".git/Notes", "Notes/CON", "Notes//Nested"])("rejects unsafe new-sheet destinations: %s", notebook => {
    expect(() => parse({ action: "new", notebook })).toThrow();
  });
  it.each(["../Kept", "NUL", "Kept/Elsewhere", "Kept."])("retains invalid titles as errors instead of silently changing them: %s", title => {
    expect(() => parse({ action: "new", title })).toThrow();
  });
  it("accepts root-level new sheets and Unicode portable names", () => {
    expect(parse({ action: "new", notebook: "", title: "বাংলা 🙂" }))
      .toEqual({ kind: "new", notebook: "", title: "বাংলা 🙂", text: "" });
  });
  it("keeps capture/share and Today entry points", () => {
    expect(parse({ action: "capture", title: "Title", text: "Words", url: "https://example.test/a" }))
      .toEqual({ kind: "capture", text: "Title\n\nWords\n\nhttps://example.test/a" });
    expect(parse({ action: "capture" })).toEqual({ kind: "capture", text: "" });
    expect(parse({ action: "today" })).toEqual({ kind: "today" });
  });
  it("accepts a search query or an empty search without turning it into a write", () => {
    expect(parse({ action: "search", query: "#tag literal <script>" })).toEqual({ kind: "search", query: "#tag literal <script>" });
    expect(parse({ action: "search", q: "Words" })).toEqual({ kind: "search", query: "Words" });
    expect(parse({ action: "search" })).toEqual({ kind: "search", query: "" });
  });
  it("rejects unknown actions, incomplete append and ambiguous values", () => {
    expect(() => parse({ action: "delete", path: "Kept.md" })).toThrow();
    expect(() => parse({ action: "append", path: "Kept.md" })).toThrow();
    expect(() => parse({ action: "append", text: "Words" })).toThrow();
    expect(() => parse({ action: "search", query: "One", q: "Two" })).toThrow();
    expect(() => parseLaunchActionParameters([["action", "new"], ["action", "append"]])).toThrow();
    expect(() => parseLaunchActionParameters([["action", "new"], ["title", "One"], ["title", "Two"]])).toThrow();
  });
  it("does not silently discard fields belonging to another action", () => {
    expect(() => parse({ action: "new", path: "Other.md" })).toThrow("does not accept path");
    expect(() => parse({ action: "open", path: "Kept.md", text: "Words" })).toThrow("does not accept text");
    expect(() => parse({ action: "today", template: "builtin:meeting-notes" })).toThrow();
    expect(() => parse({ action: "__proto__" })).toThrow("unavailable");
  });
});

describe("appending launch text", () => {
  it.each([
    ["", "Words", "Words"],
    ["\uFEFF", "Words", "\uFEFFWords"],
    ["Kept", "New", "Kept\n\nNew"],
    ["Kept\n", "New", "Kept\n\nNew"],
    ["Kept\n\n", "New", "Kept\n\nNew"],
    ["Kept\n\n\n", "New", "Kept\n\n\nNew"],
    ["Kept\r\n", "New\nLine\n", "Kept\r\n\r\nNew\r\nLine\r\n"],
    ["Kept\r", "New\r\nLine", "Kept\r\rNew\rLine"],
    ["\uFEFFKept\r\n\n", "New\n", "\uFEFFKept\r\n\nNew\r\n"],
  ])("preserves existing bytes and uses the existing EOL style", (before, text, expected) => {
    expect(appendLaunchText(before!, text!)).toBe(expected);
  });
  it("does not change a file for an empty append", () => {
    expect(appendLaunchText("\uFEFF# Kept\r\n", "")).toBe("\uFEFF# Kept\r\n");
  });
  it("never removes or rewrites any existing prefix", () => {
    fc.assert(fc.property(fc.string(), fc.string(), (before, text) => {
      expect(appendLaunchText(before, text).startsWith(before)).toBe(true);
    }), { numRuns: 300 });
  });
});
