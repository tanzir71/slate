import type { ShortcutOS } from "@slate/core";
import { commandShortcut, readKeymap } from "../commands";

/** Use the same default command registry as the desktop editor. */
export function nativeWelcome(os: ShortcutOS): string {
  const keymap = readKeymap(undefined, os, "desktop");
  const chord = (id: string) => commandShortcut(id, keymap, os);
  return `# Welcome to Slate

Your words live in ordinary Markdown files in this folder. Slate saves as you write.

## A few ways to begin

- Create a sheet with ${chord("sheet.new")}.
- Find a sheet with ${chord("app.quickOpen")}.
- Open the command palette with ${chord("app.palette")}.
- Start from a template with ${chord("sheet.fromTemplate")}.
- Open today’s note with ${chord("sheet.today")}.

Type / on an empty line to insert a block. Select a word and try Bold from the Format menu.

## Your files, your Space

Keep writing here, or open another notes folder from Spaces. You can read these files in any Markdown editor. No account or connection is needed.
`;
}
