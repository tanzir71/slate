import { describe, expect, it } from "vitest";
import {
  commandAvailable,
  commandsForSurface,
  matchCommand,
  parseShortcut,
  resolveCommandKeymap,
  shortcutLabel,
  slateCommands,
  type ShortcutInput,
} from "../src/commands";

const input = (
  key: string,
  changes: Partial<ShortcutInput> = {},
): ShortcutInput => ({
  key,
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...changes,
});
const profile = { os: "windows", surface: "web" } as const;
const editor = { editor: true, selection: false };

describe("shared command registry", () => {
  it("keeps desktop-only actions and their custom bindings out of browser profiles", () => {
    expect(commandsForSurface("web").some((command) => command.id === "view.focus")).toBe(false);
    const desktop = resolveCommandKeymap({ os: "windows", surface: "desktop" });
    expect(matchCommand(desktop.bindings, input("."), editor)).toBe("view.focus");
    expect(matchCommand(desktop.bindings, input("F11", { ctrlKey: false }), editor)).toBe("view.fullscreen");
    expect(matchCommand(desktop.bindings, input("2", { altKey: true }), editor)).toBe("space.activate2");
    const custom = resolveCommandKeymap(profile, { version: 1, bindings: { "view.focus": "Mod+j" } });
    expect(custom.issues).toHaveLength(1);
    expect(matchCommand(custom.bindings, input("j"), editor)).toBeUndefined();
  });

  it("has unique IDs, labels and conflict-free defaults for every profile", () => {
    expect(new Set(slateCommands.map((command) => command.id)).size).toBe(
      slateCommands.length,
    );
    expect(
      slateCommands.every((command) => command.label && command.group),
    ).toBe(true);
    for (const os of ["mac", "windows", "linux"] as const)
      for (const surface of ["web", "desktop"] as const) {
        expect(resolveCommandKeymap({ os, surface }).issues).toEqual([]);
      }
  });

  it("uses the browser profile for New sheet and macOS modifier labels", () => {
    const web = resolveCommandKeymap(profile).bindings;
    const desktop = resolveCommandKeymap({
      os: "windows",
      surface: "desktop",
    }).bindings;
    expect(
      shortcutLabel(
        web.find((binding) => binding.command.id === "sheet.new"),
        "windows",
      ),
    ).toBe("Alt N");
    expect(
      shortcutLabel(
        desktop.find((binding) => binding.command.id === "sheet.new"),
        "windows",
      ),
    ).toBe("Ctrl N");
    const mac = resolveCommandKeymap({ os: "mac", surface: "web" }).bindings;
    expect(
      shortcutLabel(
        mac.find((binding) => binding.command.id === "view.inspector"),
        "mac",
      ),
    ).toBe("⌘ ⇧ I");
    expect(shortcutLabel(undefined, "mac")).toBe("");
  });

  it("distinguishes palette and link contexts without a false conflict", () => {
    const { bindings } = resolveCommandKeymap(profile);
    expect(matchCommand(bindings, input("k"), editor)).toBe("app.palette");
    expect(
      matchCommand(bindings, input("k"), { editor: true, selection: true }),
    ).toBe("format.link");
    expect(
      matchCommand(bindings, input("k"), { editor: false, selection: true }),
    ).toBe("app.palette");
    expect(
      matchCommand(bindings, input("b"), { editor: false, selection: false }),
    ).toBeUndefined();
    expect(
      commandAvailable(
        { id: "x", label: "X", group: "Test", context: "selection" },
        editor,
      ),
    ).toBe(false);
  });

  it("requires exact modifiers and refuses AltGr and composing events", () => {
    const { bindings } = resolveCommandKeymap(profile);
    expect(matchCommand(bindings, input("i"), editor)).toBe("format.italic");
    expect(matchCommand(bindings, input("i", { shiftKey: true }), editor)).toBe(
      "view.inspector",
    );
    expect(
      matchCommand(bindings, input("i", { altKey: true }), editor),
    ).toBeUndefined();
    expect(
      matchCommand(bindings, input("i", { altGraph: true }), editor),
    ).toBeUndefined();
    expect(
      matchCommand(bindings, input("i", { isComposing: true }), editor),
    ).toBeUndefined();
    expect(
      matchCommand(
        bindings,
        input("i", { ctrlKey: false, metaKey: true }),
        editor,
      ),
    ).toBeUndefined();
  });

  it("handles shifted digit/punctuation codes and non-Latin keyboard layouts", () => {
    const { bindings } = resolveCommandKeymap(profile);
    expect(
      matchCommand(
        bindings,
        input("&", { code: "Digit7", shiftKey: true }),
        editor,
      ),
    ).toBe("format.ordered");
    expect(
      matchCommand(
        bindings,
        input("~", { code: "Backquote", shiftKey: true }),
        editor,
      ),
    ).toBe("format.codeblock");
    expect(matchCommand(bindings, input("и", { code: "KeyB" }), editor)).toBe(
      "format.bold",
    );
    expect(
      matchCommand(
        bindings,
        input("?", { code: "Slash", shiftKey: true }),
        editor,
      ),
    ).toBeUndefined();
    expect(matchCommand(bindings, input("/", { code: "Slash" }), editor)).toBe(
      "app.shortcuts",
    );
  });

  it("applies valid swaps and unbinding together", () => {
    const result = resolveCommandKeymap(profile, {
      version: 1,
      bindings: {
        "format.bold": "Mod+i",
        "format.italic": "Mod+b",
        "sheet.new": null,
        "format.comment": "Mod+Shift+m",
      },
    });
    expect(result.issues).toEqual([]);
    expect(matchCommand(result.bindings, input("i"), editor)).toBe(
      "format.bold",
    );
    expect(matchCommand(result.bindings, input("b"), editor)).toBe(
      "format.italic",
    );
    expect(
      result.bindings.some((binding) => binding.command.id === "sheet.new"),
    ).toBe(false);
    expect(
      matchCommand(result.bindings, input("m", { shiftKey: true }), editor),
    ).toBe("format.comment");
  });

  it("keeps defaults when a custom map conflicts or would interfere with AltGr", () => {
    for (const bindings of [
      { "format.bold": "Mod+i" },
      { "format.bold": "Ctrl+Alt+b" },
      { "format.bold": "Bogus+b" },
      { "format.bold": "Mod+NotAKey" },
      { missing: "Mod+j" },
      { "format.bold": 42 },
    ]) {
      const result = resolveCommandKeymap(profile, { version: 1, bindings });
      expect(result.issues.length).toBeGreaterThan(0);
      expect(matchCommand(result.bindings, input("b"), editor)).toBe(
        "format.bold",
      );
    }
    const mac = resolveCommandKeymap(
      { os: "mac", surface: "desktop" },
      { version: 1, bindings: { "format.bold": "Ctrl+Alt+b" } },
    );
    expect(mac.issues).toEqual([]);
  });

  it("rejects malformed map envelopes and invalid shortcut spelling", () => {
    for (const custom of [
      null,
      [],
      {},
      { version: 2, bindings: {} },
      { version: 1, bindings: null },
      { version: 1, bindings: [] },
    ])
      expect(resolveCommandKeymap(profile, custom).issues).toHaveLength(1);
    expect(() => parseShortcut("Mod+", "linux")).toThrow("Invalid shortcut");
    expect(parseShortcut("Control+CMD+Shift+Enter", "linux")).toEqual({
      key: "enter",
      ctrl: true,
      meta: true,
      shift: true,
      alt: false,
    });
    expect(
      shortcutLabel(
        {
          command: slateCommands[0]!,
          shortcut: "Alt+ArrowLeft",
          chord: parseShortcut("Alt+ArrowLeft", "mac"),
        },
        "mac",
      ),
    ).toBe("⌥ ←");
    expect(
      shortcutLabel(
        {
          command: slateCommands[0]!,
          shortcut: "Meta+Enter",
          chord: parseShortcut("Meta+Enter", "linux"),
        },
        "linux",
      ),
    ).toBe("Meta Enter");
  });
});
