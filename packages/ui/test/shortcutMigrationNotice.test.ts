import { expect, it, vi } from "vitest";
import { takeShortcutMigrationNotice } from "../src/shortcutMigrationNotice";

function settings() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
}

it("uses registry labels for every OS and marks the notice once across surfaces", () => {
  for (const os of ["mac", "windows", "linux"] as const) {
    const preferences = settings();
    const message = takeShortcutMigrationNotice(os, "web", preferences);
    const mod = os === "mac" ? "⌘" : "Ctrl";
    expect(message).toBe(`Default shortcuts changed. Italic: ${mod} I. Inspector: ${mod} ⇧ I.`);
    expect(takeShortcutMigrationNotice(os, "desktop", preferences)).toBeUndefined();
    expect(preferences.setItem).toHaveBeenCalledTimes(1);
  }
});

it("honors the existing marker without overwriting any settings", () => {
  const preferences = settings();
  preferences.values.set("slate.shortcuts.v2", "seen");
  preferences.values.set("slate.appearance", "dark");
  expect(takeShortcutMigrationNotice("mac", "web", preferences)).toBeUndefined();
  expect(preferences.setItem).not.toHaveBeenCalled();
  expect(preferences.values.get("slate.appearance")).toBe("dark");
});

it("skips the optional notice when settings access or writes fail", () => {
  const blocked = () => { throw new DOMException("Settings unavailable", "SecurityError"); };
  expect(takeShortcutMigrationNotice("windows", "web", { getItem: blocked, setItem: blocked })).toBeUndefined();
  expect(takeShortcutMigrationNotice("mac", "desktop", { getItem: () => null, setItem: blocked })).toBeUndefined();
});

it("contains a blocked global storage getter inside the optional-notice boundary", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new DOMException("Storage blocked", "SecurityError"); } });
  try {
    expect(takeShortcutMigrationNotice("linux", "web")).toBeUndefined();
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
