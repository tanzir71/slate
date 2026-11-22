import { expect, it } from "vitest";
import type { ShortcutOS } from "@slate/core";
import { commandShortcut, readKeymap } from "../src/commands";
import { nativeWelcome } from "../src/native/nativeWelcome";

it.each<ShortcutOS>(["windows", "mac", "linux"])("teaches the actual %s desktop command bindings in a portable welcome note", os => {
  const note = nativeWelcome(os), keymap = readKeymap(undefined, os, "desktop");
  expect(note).toMatch(/^# Welcome to Slate\n/);
  expect(note).toContain("ordinary Markdown files");
  expect(note).toContain("Type / on an empty line");
  for (const id of ["sheet.new", "app.quickOpen", "app.palette", "sheet.fromTemplate", "sheet.today"]) {
    const label = commandShortcut(id, keymap, os);
    expect(label, id).not.toBe(""); expect(note).toContain(`with ${label}.`);
  }
  expect(note).toContain(os === "mac" ? "⌘" : "Ctrl");
  expect(note).not.toMatch(/https?:|\r/);
});
