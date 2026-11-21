import type { BrowserDirectoryHandle } from "./browserFiles";
import type { MarkdownFileSnapshot } from "./fileIO";

export interface DirectorySnapshotRequest { id: number; root: BrowserDirectoryHandle }
export type DirectorySnapshotReply =
  | { id: number; kind: "snapshot"; sheets: MarkdownFileSnapshot[] }
  | { id: number; kind: "error"; name: string; message: string };
