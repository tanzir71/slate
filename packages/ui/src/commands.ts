import {
  resolveCommandKeymap,
  shortcutLabel,
  type ResolvedKeymap,
  type ShortcutInput,
  type ShortcutOS,
} from "@slate/core";

export function shortcutOS(platform = navigator.platform): ShortcutOS {
  return /Mac|iPhone|iPad/.test(platform)
    ? "mac"
    : /Linux/.test(platform)
      ? "linux"
      : "windows";
}

export function keyboardInput(event: KeyboardEvent): ShortcutInput {
  return {
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    altGraph: event.getModifierState("AltGraph"),
    isComposing: event.isComposing,
  };
}

export function readKeymap(
  bytes: Uint8Array | undefined,
  os: ShortcutOS,
): ResolvedKeymap {
  try {
    const custom: unknown = bytes
      ? JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
      : undefined;
    return resolveCommandKeymap({ os, surface: "web" }, custom);
  } catch {
    return {
      ...resolveCommandKeymap({ os, surface: "web" }),
      issues: [
        { commandId: "", message: "The keymap must contain valid UTF-8 JSON." },
      ],
    };
  }
}

export function commandShortcut(
  id: string,
  keymap: ResolvedKeymap,
  os: ShortcutOS,
): string {
  return shortcutLabel(
    keymap.bindings.find((binding) => binding.command.id === id),
    os,
  );
}

/** No CodeMirror import: the workspace can stay lazy until a sheet is opened. */
export interface MarkdownEditorHandle {
  runFormat(id: string): boolean;
  focus(): void;
  hasFocus(): boolean;
  hasSelection(): boolean;
}
