import { describe, expect, it } from "vitest";
import {
  commandShortcut,
  keyboardInput,
  readKeymap,
  shortcutOS,
} from "../src/commands";

describe("workspace keyboard adapter", () => {
  it("detects platform labels without mixing browser and desktop shortcuts", () => {
    expect(shortcutOS("MacIntel")).toBe("mac");
    expect(shortcutOS("Linux x86_64")).toBe("linux");
    expect(shortcutOS("Win32")).toBe("windows");
    expect(
      commandShortcut("sheet.new", readKeymap(undefined, "mac"), "mac"),
    ).toBe("⌥ N");
  });

  it("loads a Space keymap and falls back atomically for conflicts or invalid bytes", () => {
    const encode = (value: string) => new TextEncoder().encode(value);
    const valid = readKeymap(
      encode('{"version":1,"bindings":{"sheet.new":"Alt+m"}}'),
      "windows",
    );
    expect(valid.issues).toEqual([]);
    expect(commandShortcut("sheet.new", valid, "windows")).toBe("Alt M");
    for (const bytes of [
      encode("{"),
      new Uint8Array([255]),
      encode(
        '{"version":1,"bindings":{"format.bold":"Mod+i","sheet.new":"Alt+m"}}',
      ),
    ]) {
      const result = readKeymap(bytes, "windows");
      expect(result.issues.length).toBeGreaterThan(0);
      expect(commandShortcut("sheet.new", result, "windows")).toBe("Alt N");
    }
  });

  it("adapts the physical key and composing state without changing modifiers", () => {
    const event = new KeyboardEvent("keydown", {
      key: "&",
      code: "Digit7",
      ctrlKey: true,
      shiftKey: true,
      isComposing: true,
    });
    expect(keyboardInput(event)).toMatchObject({
      key: "&",
      code: "Digit7",
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
      altKey: false,
      isComposing: true,
      altGraph: false,
    });
  });
});
