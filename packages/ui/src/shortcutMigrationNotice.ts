import { resolveCommandKeymap, type ShortcutOS, type ShortcutProfile } from "@slate/core";
import { commandShortcut } from "./commands";

type NoticeSettings = Pick<Storage, "getItem" | "setItem">;
const noticeKey = "slate.shortcuts.v2";

/** Keep the existing seen marker; optional notice storage must never prevent opening writing. */
export function takeShortcutMigrationNotice(
  os: ShortcutOS,
  surface: ShortcutProfile["surface"],
  settings?: NoticeSettings,
): string | undefined {
  try {
    const preferences = settings ?? localStorage;
    if (preferences.getItem(noticeKey)) return undefined;
    preferences.setItem(noticeKey, "seen");
  } catch {
    return undefined;
  }
  const keymap = resolveCommandKeymap({ os, surface });
  return `Default shortcuts changed. Italic: ${commandShortcut("format.italic", keymap, os)}. Inspector: ${commandShortcut("view.inspector", keymap, os)}.`;
}
