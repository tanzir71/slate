export type ShortcutOS = "mac" | "windows" | "linux";
export interface ShortcutProfile {
  os: ShortcutOS;
  surface: "web" | "desktop";
}
export type CommandContext = "always" | "editor" | "selection" | "no-selection" | "table" | "table-multiple-columns";
export interface CommandDefinition {
  id: string;
  label: string;
  group: string;
  context?: CommandContext;
  shortcut?: string;
  webShortcut?: string;
  surfaces?: readonly ShortcutProfile["surface"][];
}

const format = (
  id: string,
  label: string,
  shortcut?: string,
): CommandDefinition => ({
  id: `format.${id}`,
  label,
  group: "Format",
  context: "editor",
  ...(shortcut ? { shortcut } : {}),
});

/** Only implemented actions belong here; every consumer uses these same IDs. */
export const slateCommands: readonly CommandDefinition[] = [
  { id: "sheet.today", label: "Open Today’s note", group: "Workspace", shortcut: "Mod+Shift+d" },
  { id: "sheet.pin", label: "Toggle pinned sheet", group: "Workspace", context: "editor" },
  { id: "view.sidebar", label: "Toggle navigation", group: "View", shortcut: "Mod+\\" },
  { id: "view.sheets", label: "Toggle sheet list", group: "View", shortcut: "Mod+Alt+\\" },
  { id: "view.density", label: "Toggle sheet density", group: "View" },
  {
    id: "app.palette",
    label: "Command palette",
    group: "Workspace",
    shortcut: "Mod+k",
    context: "no-selection",
  },
  {
    id: "app.quickOpen",
    label: "Quick open",
    group: "Workspace",
    shortcut: "Mod+p",
    surfaces: ["web"],
  },
  {
    id: "sheet.new",
    label: "New sheet",
    group: "Workspace",
    shortcut: "Mod+n",
    webShortcut: "Alt+n",
  },
  {
    id: "sheet.fromTemplate",
    label: "New from template",
    group: "Workspace",
    shortcut: "Mod+Shift+n",
    webShortcut: "Alt+Shift+n",
    surfaces: ["web"],
  },
  {
    id: "sheet.search",
    label: "Search everywhere",
    group: "Workspace",
    shortcut: "Mod+Shift+f",
  },
  { id: "sheet.save", label: "Save", group: "Workspace", shortcut: "Mod+s" },
  { id: "space.export", label: "Export Space as .zip", group: "Workspace" },
  { id: "space.switch", label: "Switch Space", group: "Workspace" },
  { id: "search.undoReplace", label: "Undo replacements", group: "Edit", surfaces: ["web"] },
  { id: "navigation.back", label: "Go back", group: "Workspace", shortcut: "Alt+ArrowLeft", surfaces: ["web"] },
  { id: "navigation.forward", label: "Go forward", group: "Workspace", shortcut: "Alt+ArrowRight", surfaces: ["web"] },
  { id: "view.split", label: "Toggle split editor", group: "View", surfaces: ["web"] },
  { id: "view.closeTab", label: "Close current tab", group: "View", surfaces: ["web"] },
  {
    id: "view.inspector",
    label: "Toggle inspector",
    group: "View",
    shortcut: "Mod+Shift+i",
  },
  {
    id: "app.shortcuts",
    label: "Keyboard shortcuts",
    group: "Help",
    shortcut: "Mod+/",
  },
  { id: "app.about", label: "About Slate", group: "Help" },
  { id: "app.editorSettings", label: "Editor settings", group: "Workspace", shortcut: "Mod+," },
  { id: "snippet.picker", label: "Insert snippet", group: "Workspace", context: "editor", shortcut: "Mod+;", surfaces: ["web"] },
  { id: "block.settings", label: "Manage custom blocks", group: "Workspace", surfaces: ["web"] },
  { id: "snippet.settings", label: "Manage snippets", group: "Workspace", surfaces: ["web"] },
  { id: "tidy.document", label: "Tidy document", group: "Edit", context: "editor", shortcut: "Alt+Shift+f", surfaces: ["web"] },
  { id: "tidy.batch", label: "Batch Tidy", group: "Edit", surfaces: ["web"] },
  { id: "tidy.undoBatch", label: "Undo batch Tidy", group: "Edit", surfaces: ["web"] },
  { id: "appearance.light", label: "Use Light appearance", group: "View" },
  { id: "appearance.dark", label: "Use Dark appearance", group: "View" },
  { id: "appearance.system", label: "Follow system appearance", group: "View" },
  { id: "table.format", label: "Align table padding", group: "Table", context: "table" },
  { id: "table.insertBefore", label: "Insert table column before", group: "Table", context: "table" },
  { id: "table.insertAfter", label: "Insert table column after", group: "Table", context: "table" },
  { id: "table.deleteColumn", label: "Delete table column", group: "Table", context: "table-multiple-columns" },
  ...(["left", "center", "right", "none"] as const).map((alignment): CommandDefinition => ({
    id: `table.align.${alignment}`,
    label: alignment === "none" ? "Remove table column alignment" : `Align table column ${alignment}`,
    group: "Table", context: "table",
  })),
  format("bold", "Bold", "Mod+b"),
  format("italic", "Italic", "Mod+i"),
  format("strike", "Strikethrough", "Mod+Shift+x"),
  format("highlight", "Highlight", "Mod+Shift+h"),
  format("code", "Inline code", "Mod+`"),
  format("comment", "Comment"),
  { ...format("link", "Insert link", "Mod+k"), context: "selection" },
  format("paragraph", "Paragraph", "Mod+0"),
  ...[1, 2, 3, 4, 5, 6].map((level) =>
    format(`heading${level}`, `Heading ${level}`, `Mod+${level}`),
  ),
  format("ordered", "Numbered list", "Mod+Shift+7"),
  format("bullet", "Bulleted list", "Mod+Shift+8"),
  format("task", "Task list", "Mod+Shift+9"),
  format("quote", "Blockquote", "Mod+Shift+."),
  format("codeblock", "Code block", "Mod+Shift+`"),
  format("toggleTask", "Toggle task", "Mod+Enter"),
  { id: "view.focus", label: "Toggle focus mode", group: "View", shortcut: "Mod+.", surfaces: ["desktop"] },
  { id: "view.typewriter", label: "Toggle typewriter mode", group: "View", surfaces: ["desktop"] },
  { id: "view.fullscreen", label: "Toggle full-screen mode", group: "View", shortcut: "F11", surfaces: ["desktop"] },
  ...Array.from({ length: 9 }, (_, index): CommandDefinition => ({
    id: `space.activate${index + 1}`,
    label: `Switch to Space ${index + 1}`,
    group: "Workspace",
    shortcut: `Mod+Alt+${index + 1}`,
    surfaces: ["desktop"],
  })),
];

export function commandsForSurface(
  surface: ShortcutProfile["surface"],
  commands: readonly CommandDefinition[] = slateCommands,
): readonly CommandDefinition[] {
  return commands.filter((command) => !command.surfaces || command.surfaces.includes(surface));
}

export interface KeyChord {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}
export interface CommandBinding {
  command: CommandDefinition;
  shortcut: string;
  chord: KeyChord;
}
export interface KeymapIssue {
  commandId: string;
  message: string;
}
export interface ResolvedKeymap {
  bindings: readonly CommandBinding[];
  issues: readonly KeymapIssue[];
}

export function parseShortcut(value: string, os: ShortcutOS): KeyChord {
  const parts = value.split("+").map((part) => part.trim().toLowerCase());
  const key = parts.pop();
  if (
    !key ||
    !/^(?:[a-z0-9/.,;`=[\]\\-]|enter|escape|tab|space|arrow(?:up|down|left|right)|f(?:[1-9]|1[0-2]))$/.test(
      key,
    )
  )
    throw new Error(`Invalid shortcut: ${value}`);
  const modifiers = new Set(
    parts.map((part) =>
      part === "mod"
        ? os === "mac"
          ? "meta"
          : "ctrl"
        : part === "control"
          ? "ctrl"
          : part === "cmd"
            ? "meta"
            : part,
    ),
  );
  if (
    [...modifiers].some(
      (part) => !["ctrl", "meta", "alt", "shift"].includes(part),
    )
  )
    throw new Error(`Invalid modifier: ${value}`);
  return {
    key,
    ctrl: modifiers.has("ctrl"),
    meta: modifiers.has("meta"),
    alt: modifiers.has("alt"),
    shift: modifiers.has("shift"),
  };
}

function sameChord(first: KeyChord, second: KeyChord): boolean {
  return (
    first.key === second.key &&
    first.ctrl === second.ctrl &&
    first.meta === second.meta &&
    first.alt === second.alt &&
    first.shift === second.shift
  );
}

function contextsOverlap(
  first: CommandContext = "always",
  second: CommandContext = "always",
) {
  return !(
    [first, second].includes("selection") &&
    [first, second].includes("no-selection")
  );
}

function bindingIssues(
  bindings: readonly CommandBinding[],
  profile: ShortcutProfile,
): KeymapIssue[] {
  const issues: KeymapIssue[] = [];
  for (const [index, binding] of bindings.entries()) {
    const { chord, command } = binding;
    if (
      profile.os !== "mac" &&
      chord.ctrl &&
      chord.alt &&
      /^[a-z]$/.test(chord.key)
    )
      issues.push({
        commandId: command.id,
        message: "Ctrl+Alt+letter conflicts with AltGr typing.",
      });
    for (const other of bindings.slice(0, index)) {
      if (
        sameChord(chord, other.chord) &&
        contextsOverlap(command.context, other.command.context)
      )
        issues.push({
          commandId: command.id,
          message: `Shortcut conflicts with ${other.command.label}.`,
        });
    }
  }
  return issues;
}

/** Invalid custom maps leave the complete defaults active; a swap is applied atomically. */
export function resolveCommandKeymap(
  profile: ShortcutProfile,
  custom: unknown = undefined,
  commands = slateCommands,
): ResolvedKeymap {
  commands = commandsForSurface(profile.surface, commands);
  const defaults = commands.flatMap((command) => {
    const shortcut =
      profile.surface === "web"
        ? (command.webShortcut ?? command.shortcut)
        : command.shortcut;
    return shortcut
      ? [{ command, shortcut, chord: parseShortcut(shortcut, profile.os) }]
      : [];
  });
  if (custom === undefined)
    return { bindings: defaults, issues: bindingIssues(defaults, profile) };
  if (
    typeof custom !== "object" ||
    custom === null ||
    !("version" in custom) ||
    custom.version !== 1 ||
    !("bindings" in custom) ||
    typeof custom.bindings !== "object" ||
    custom.bindings === null ||
    Array.isArray(custom.bindings)
  ) {
    return {
      bindings: defaults,
      issues: [
        {
          commandId: "",
          message: "Use keymap version 1 with a bindings object.",
        },
      ],
    };
  }
  const bindings = [...defaults];
  const issues: KeymapIssue[] = [];
  for (const [id, shortcut] of Object.entries(custom.bindings)) {
    const command = commands.find((entry) => entry.id === id);
    if (!command || (shortcut !== null && typeof shortcut !== "string")) {
      issues.push({
        commandId: id,
        message: "Unknown command or invalid shortcut.",
      });
      continue;
    }
    const previous = bindings.findIndex((entry) => entry.command.id === id);
    if (previous >= 0) bindings.splice(previous, 1);
    if (shortcut !== null) {
      try {
        bindings.push({
          command,
          shortcut,
          chord: parseShortcut(shortcut, profile.os),
        });
      } catch (error) {
        issues.push({
          commandId: id,
          message: error instanceof Error ? error.message : "Invalid shortcut.",
        });
      }
    }
  }
  issues.push(...bindingIssues(bindings, profile));
  return { bindings: issues.length ? defaults : bindings, issues };
}

export interface ShortcutInput {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  altGraph?: boolean;
  isComposing?: boolean;
}
export interface CommandAvailability {
  editor: boolean;
  selection: boolean;
  readonly tableColumns?: number;
}

export function commandAvailable(
  command: CommandDefinition,
  state: CommandAvailability,
): boolean {
  if (command.context === "table") return state.editor && (state.tableColumns ?? 0) > 0;
  if (command.context === "table-multiple-columns") return state.editor && (state.tableColumns ?? 0) > 1;
  if (command.context === "editor") return state.editor;
  if (command.context === "selection") return state.editor && state.selection;
  if (command.context === "no-selection")
    return !state.editor || !state.selection;
  return true;
}

export function matchCommand(
  bindings: readonly CommandBinding[],
  event: ShortcutInput,
  state: CommandAvailability,
): string | undefined {
  if (event.altGraph || event.isComposing) return undefined;
  const punctuation: Record<string, string> = {
    Slash: "/",
    Backquote: "`",
    Period: ".",
    Comma: ",",
    Semicolon: ";",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Equal: "=",
    Minus: "-",
    Space: "space",
  };
  const codeKey = event.code?.match(/^(?:Key([A-Z])|Digit([0-9]))$/);
  const key = (
    codeKey?.[1] ??
    codeKey?.[2] ??
    punctuation[event.code ?? ""] ??
    (event.key === " " ? "space" : event.key)
  ).toLowerCase();
  const chord = {
    key,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey,
  };
  return bindings.find(
    (entry) =>
      sameChord(entry.chord, chord) && commandAvailable(entry.command, state),
  )?.command.id;
}

export function shortcutLabel(
  binding: CommandBinding | undefined,
  os: ShortcutOS,
): string {
  if (!binding) return "";
  const chord = binding.chord;
  const key =
    (
      {
        enter: "Enter",
        escape: "Esc",
        space: "Space",
        arrowup: "↑",
        arrowdown: "↓",
        arrowleft: "←",
        arrowright: "→",
      } as Record<string, string>
    )[chord.key] ?? chord.key.toUpperCase();
  return [
    chord.ctrl && "Ctrl",
    chord.meta && (os === "mac" ? "⌘" : "Meta"),
    chord.alt && (os === "mac" ? "⌥" : "Alt"),
    chord.shift && "⇧",
    key,
  ]
    .filter(Boolean)
    .join(" ");
}
