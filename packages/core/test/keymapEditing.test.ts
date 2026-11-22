import { expect, it } from "vitest";
import {
  editKeymapSource,
  readKeymapSource,
  resetKeymapSource,
} from "../src/keymapEditing";
import { resolveCommandKeymap } from "../src/commands";

it("edits, unbinds and resets one command while retaining other bindings and extension fields", () => {
  const source =
    '\ufeff{\r\n  "version": 1,\r\n  "bindings": {"format.bold": "Mod+j", "format.italic": null},\r\n  "note": {"keep": true}\r\n}\r\n';
  const edited = editKeymapSource(source, "format.bold", "Alt+Shift+b");
  expect(edited.startsWith("\ufeff")).toBe(true);
  expect(edited.replaceAll("\r\n", "")).not.toContain("\n");
  expect(readKeymapSource(edited)).toEqual({
    version: 1,
    bindings: { "format.bold": "Alt+Shift+b", "format.italic": null },
    note: { keep: true },
  });
  const unbound = editKeymapSource(edited, "format.bold", null);
  expect(readKeymapSource(unbound).bindings["format.bold"]).toBeNull();
  const restored = editKeymapSource(unbound, "format.bold", undefined);
  expect(readKeymapSource(restored).bindings).toEqual({
    "format.italic": null,
  });
  expect(readKeymapSource(resetKeymapSource(restored))).toEqual({
    version: 1,
    bindings: {},
    note: { keep: true },
  });
});

it("creates a missing keymap without mutating malformed or future configuration", () => {
  expect(readKeymapSource(undefined)).toEqual({ version: 1, bindings: {} });
  expect(
    readKeymapSource(editKeymapSource(undefined, "format.bold", "Mod+j"))
      .bindings,
  ).toEqual({ "format.bold": "Mod+j" });
  for (const source of [
    "",
    "{",
    "null",
    "[]",
    '{"version":2,"bindings":{}}',
    '{"version":1,"bindings":[]}',
    '{"version":1,"bindings":{"format.bold":5}}',
  ]) {
    expect(() => editKeymapSource(source, "format.bold", "Mod+j")).toThrow();
    expect(() => resetKeymapSource(source)).toThrow();
  }
  expect(
    readKeymapSource(editKeymapSource(undefined, "__proto__", null)).bindings,
  ).toHaveProperty("__proto__", null);
});

it("rejects browser-reserved custom shortcuts atomically while retaining desktop chords", () => {
  for (const os of ["windows", "linux", "mac"] as const) {
    for (const shortcut of [
      "Mod+n",
      "Mod+Shift+n",
      "Mod+t",
      "Mod+Shift+t",
      "Mod+w",
      "Mod+Tab",
      "Mod+Shift+Tab",
      "Ctrl+Tab",
    ]) {
      const result = resolveCommandKeymap(
        { os, surface: "web" },
        { version: 1, bindings: { "sheet.new": shortcut } },
      );
      expect(result.issues).toContainEqual({
        commandId: "sheet.new",
        message: expect.stringContaining("reserved by the browser"),
      });
      expect(
        result.bindings.find((binding) => binding.command.id === "sheet.new")
          ?.shortcut,
      ).toBe("Alt+n");
    }
    expect(
      resolveCommandKeymap(
        { os, surface: "desktop" },
        { version: 1, bindings: { "sheet.new": "Mod+n" } },
      ).issues,
    ).toEqual([]);
  }
});
