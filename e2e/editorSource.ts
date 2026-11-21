import type { Locator } from "@playwright/test";

/** Read the whole current buffer, including hidden syntax and unsaved drafts. */
export async function editorSource(editor: Locator): Promise<string> {
  return editor.evaluate(content => {
    const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
    // The pinned EditorView.findFromDOM follows this Tile mapping. Keep it inside this read-only fixture.
    const tile: unknown = Reflect.get(content, "cmTile");
    if (!record(tile) || !record(tile.root) || !record(tile.root.view) || !record(tile.root.view.state))
      throw new Error("The editor buffer is unavailable");
    const doc = tile.root.view.state.doc;
    if (!record(doc) || typeof doc.length !== "number" || typeof doc.sliceString !== "function" || typeof doc.toString !== "function")
      throw new Error("The editor document is unavailable");
    const source: unknown = doc.toString();
    if (typeof source !== "string" || source.length !== doc.length) throw new Error("Incomplete editor source");
    return source;
  });
}
