import { commandsForSurface, slateCommands } from "@slate/core";

const supported = new Set([
  "app.palette", "app.shortcuts", "app.editorSettings", "sheet.new", "sheet.search", "sheet.save",
  "view.sidebar", "view.sheets", "view.inspector", "view.focus",
  "view.typewriter", "view.fullscreen", "appearance.light", "appearance.dark",
  "appearance.system",
]);

/** Until native folder wiring lands, expose only actions implemented by the preview shell. */
export function desktopPreviewCommands(spaceCount: number) {
  return commandsForSurface("desktop", slateCommands).filter((command) =>
    supported.has(command.id) || command.group === "Format" || command.group === "Table" ||
    (/^space\.activate[1-9]$/.test(command.id) && Number(command.id.at(-1)) <= spaceCount),
  );
}
