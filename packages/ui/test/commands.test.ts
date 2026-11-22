import { describe, expect, it } from "vitest";
import {
  commandShortcut,
  createCursorStore,
  keyboardInput,
  readKeymap,
  shortcutOS,
  workspaceCommands,
} from "../src/commands";

describe("workspace keyboard adapter", () => {
  it("labels actual native tab actions and keeps tab cycling on Control even on macOS", () => {
    for (const os of ["windows", "linux", "mac"] as const) {
      const native = readKeymap(undefined, os, "desktop"), mac = os === "mac";
      expect(native.issues).toEqual([]);
      expect(commandShortcut("view.newTab", native, os)).toBe(mac ? "⌘ T" : "Ctrl T");
      expect(commandShortcut("view.closeTab", native, os)).toBe(mac ? "⌘ W" : "Ctrl W");
      expect(commandShortcut("view.reopenTab", native, os)).toBe(mac ? "⌘ ⇧ T" : "Ctrl ⇧ T");
      const next = native.bindings.find(binding => binding.command.id === "view.nextTab");
      const previous = native.bindings.find(binding => binding.command.id === "view.previousTab");
      expect(next?.chord).toMatchObject({ key: "tab", ctrl: true, meta: false, shift: false });
      expect(previous?.chord).toMatchObject({ key: "tab", ctrl: true, meta: false, shift: true });
    }
  });
  it("uses native chords for the implemented disk workspace actions only", () => {
    const native = readKeymap(undefined, "mac", "desktop");
    expect(commandShortcut("sheet.new", native, "mac")).toBe("⌘ N");
    expect(commandShortcut("sheet.fromTemplate", native, "mac")).toBe("⌘ ⇧ N");
    expect(commandShortcut("app.quickOpen", native, "mac")).toBe("⌘ P");
    expect(commandShortcut("navigation.back", native, "mac")).toBe("⌥ ←");
    expect(commandShortcut("navigation.forward", readKeymap(undefined, "windows"), "windows")).toBe("Alt →");
    expect(native.issues).toEqual([]);
    expect(workspaceCommands("desktop").filter(command => command.id !== "app.capture" && command.id !== "space.openFolder").map((command) => command.id)).toEqual(workspaceCommands("web").map((command) => command.id));
    expect(commandShortcut("space.openFolder", native, "mac")).toBe("⌘ O");
    expect(workspaceCommands("desktop").find(command => command.id === "space.openFolder")?.label).toBe("Open a folder");
    expect(workspaceCommands("web").some(command => command.id === "space.openFolder")).toBe(false);
    expect(workspaceCommands("desktop").find(command => command.id === "app.capture")?.label).toBe("Quick Capture");
    expect(workspaceCommands("web").some(command => command.id === "app.capture")).toBe(false);
    expect(workspaceCommands("desktop").some((command) => command.id.startsWith("space.activate"))).toBe(false);
  });
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


it("publishes cursor positions only when they change and unsubscribes listeners", () => {
  const store = createCursorStore();
  let updates = 0;
  const unsubscribe = store.subscribe(() => { updates++; });
  const initial = store.getSnapshot();
  store.update({ line: 1, column: 1, lines: 1 });
  expect(store.getSnapshot()).toBe(initial);
  expect(updates).toBe(0);
  store.update({ line: 3, column: 4, lines: 8 });
  expect(store.getSnapshot()).toEqual({ line: 3, column: 4, lines: 8 });
  expect(updates).toBe(1);
  unsubscribe();
  store.update({ line: 4, column: 1, lines: 8 });
  expect(updates).toBe(1);
});
