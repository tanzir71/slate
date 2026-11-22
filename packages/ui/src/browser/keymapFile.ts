import {
  readKeymapSource,
  resolveCommandKeymap,
  type ShortcutProfile,
} from "@slate/core";
import { decodeText } from "@slate/storage/file-io";
import type { WorkspaceStore } from "./workspaceStore";
import { workspaceCommands } from "../commands";

export const keymapPath = ".slate/keymap.json";
export interface KeymapFile {
  bytes: Uint8Array | undefined;
  source: string;
  readable: boolean;
}
export async function loadKeymapFile(
  store: WorkspaceStore,
): Promise<KeymapFile> {
  const bytes = (await store.space.files.read(keymapPath))?.slice();
  if (bytes === undefined)
    return {
      bytes,
      source: JSON.stringify(readKeymapSource(undefined), null, 2) + "\n",
      readable: true,
    };
  try {
    return { bytes, source: decodeText(bytes, true), readable: true };
  } catch {
    return { bytes, source: "", readable: false };
  }
}
export async function saveKeymapFile(
  store: WorkspaceStore,
  base: KeymapFile,
  source: string,
  profile: ShortcutProfile,
) {
  if (!base.readable)
    throw new Error(
      "Choose how to replace the unreadable keymap before saving.",
    );
  const resolved = resolveCommandKeymap(
    profile,
    readKeymapSource(source),
    workspaceCommands(profile.surface),
  );
  if (resolved.issues.length)
    throw new Error(
      resolved.issues
        .map((issue) => `${issue.commandId}: ${issue.message}`)
        .join(" "),
    );
  return store.space.saveSnapshot(keymapPath, source, base.bytes);
}
